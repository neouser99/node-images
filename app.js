'use strict'

const fs = require('fs'),
      cofs = require('co-fs'),
      mkdirp = require('mkdirp'),
      ip = require('ip'),
      path = require('path'),
      join = path.join,
      basename = path.basename,
      dirname = path.dirname,
      extname = path.extname

const app = require('koa')(),
      body = require('koa-body')(),
      mount = require('koa-mount'),
      router = require('koa-router')(),
      serve = require('koa-static'),
      views = require('koa-views')

const easyimage = require('easyimage')

const IMAGES = join(__dirname, 'images'),
      PREVIEWS = join(IMAGES, '.thumbs')

app.use(mount('/semantic', serve('./semantic', {defer: true})))

app.use(function* logger(next) {
  if (~this.path.indexOf('/semantic')) return

  let start = process.hrtime()
  yield next

  let end = process.hrtime(start)
  let totalsec = end[0] + end[1] / 1e9
  console.log('%s %s %s %dms', this.method, this.originalUrl, this.status, totalsec)
})

app.use(function* responseTime(next) {
  if (~this.path.indexOf('/semantic')) return

  let start = process.hrtime()
  yield next

  let end = process.hrtime(start)
  let totalsec = end[0] + end[1] / 1e9
  this.set('X-Response-Time', totalsec + 'ms')
})

app.use(function* title(next) {
  this.state.title = 'Pictures'
  yield next
})

app.use(function* is_admin(next) {
  // this.state.is_admin = /^(::1|127\.|10\.|172\.1[6-9]\.|172\.2[0-9]\.|172\.3[0-1]\.|192\.168\.)/.test(this.ip)
  this.state.is_admin = ip.isPrivate(this.ip)
  yield next
})

router.use(function* setup(next) {
  let d = decodeURI(this.path)
  this.state.abspath = join(IMAGES, d)
  let stats = fs.statSync(this.state.abspath)

  if (stats.isFile()) {
    this.state.is_file = true
    this.state.absdir = dirname(this.state.abspath)
    this.state.reldir = dirname(d)
    this.state.file = basename(d)
  } else if (stats.isDirectory()) {
    this.state.is_file = false
    this.state.absdir = this.state.abspath
    this.state.reldir = d

    if (this.state.reldir[this.state.reldir.length - 1] !== '/')
      return this.redirect(this.state.reldir + '/')
  } else {
    // 404?
  }

  console.log('in directory: %s, path: %s', this.state.reldir, this.state.abspath)
  this.state.previews = join(PREVIEWS, this.state.reldir)
  try {
    fs.statSync(this.state.previews)
  } catch(_) {
    mkdirp.sync(this.state.previews)
  }

  try {
    let file = join(this.state.absdir, '.hidden')
    console.log('loading hidden: %s', file)
    this.state.hidden = JSON.parse(fs.readFileSync(file))
  } catch(_) {
    this.state.hidden = {}
  }

  yield next
})

router.get(/(.*)/, function* dir(next) {
  if (this.state.is_file)
    return yield next

  yield next

  let isdir = function (f) {
    let stats = fs.statSync(f.path)
    return f.name !== 'orginals' && stats.isDirectory()
  }

  let ispic = function (f) {
    return /.*(png|jpe?g|gif)$/i.test(f.path)
  }

  let directory = this.state.reldir
  let ipath = this.state.abspath
  let files = yield cofs.readdir(ipath)

  files = files
    .filter((file) => file[0] !== '.')
    .filter((file) => this.state.is_admin || !this.state.hidden[file])
    .map((file) => ({
      name: file,
      rpath: `${directory}${file}`,
      path: join(ipath, file),
      hidden: this.state.hidden[file]
    }))

  this.state.files = files.filter(ispic)
  this.state.dirs = files.filter(isdir)

  this.state.crumbs = [{ name: '(root)', path: '/' }]
  if (~directory.indexOf('/')) {
    let here = ''
    let parts = directory.split('/').filter((part) => part.length)
    this.state.crumbs = this.state.crumbs.concat(parts.map((i) => ({ name: i, path: here += `/${i}/` })))
  }
  this.state.crumbs[this.state.crumbs.length - 1].active = true

  yield this.render('index')
})

router.get(/(.*)/, function* full(next) {
  if (!this.state.is_file)
    return

  yield next

  let path = this.state.abspath
  if (~this.querystring.indexOf('thumbnail')) {
    let preview = join(this.state.previews, path)

    try {
      fs.statSync(preview)
    } catch(_) {
      console.log('creating preview: %s -> %s', path, preview)
      yield easyimage.rescrop({
        src: path,
        dst: preview,
        width: 500, height: 500,
        cropwidth: 256, cropheight: 256,
        x: 0, y: 0
      })
    }

    this.set('Cache-Control', 'public,no-transform,max-age=31536000')
    this.type = extname(preview)
    this.body = fs.createReadStream(preview)
  } else {
    console.log('getting file: %s', path)
    this.set('Cache-Control', 'public,no-transform,max-age=31536000')
    this.type = extname(path)
    this.body = fs.createReadStream(path)
  }
})

router.post(/(.*)/, body, function* edit(next) {
  if (!this.state.is_admin || !this.state.is_file)
    return yield next

  this.state.hidden[this.state.file] = this.request.body.action === 'hide'
  console.log('saving hidden: %s', join(this.state.absdir, '.hidden'), this.state.hidden)
  fs.writeFileSync(join(this.state.absdir, '.hidden'), JSON.stringify(this.state.hidden))

  this.redirect(this.state.reldir)
})

app.use(views('views', {
  default: 'jade'
}))

app.use(router.routes())

app.listen(3000, function () {
  console.log('app listening on port 3000')
  console.log('images directory: %s', IMAGES)
})
