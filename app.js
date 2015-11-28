'use strict'

const fs = require('fs'),
      cofs = require('co-fs'),
      mkdirp = require('mkdirp'),
      path = require('path'),
      join = path.join,
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
  this.state.is_admin = /^(::1|127\.|10\.|172\.1[6-9]\.|172\.2[0-9]\.|172\.3[0-1]\.|192\.168\.)/.test(this.ip)
  yield next
})

router.post('/hide', body, function* hide(next) {
  if (!this.state.is_admin)
    return yield next

  let directory = this.request.body.directory
  let ipath = join(IMAGES, directory)

  let hidden = undefined
  try {
    hidden = JSON.parse(fs.readFileSync(join(ipath, '.hidden')))
  } catch(_) {
    hidden = {}
  }

  hidden[this.request.body.file] = true
  fs.writeFileSync(join(ipath, '.hidden'), JSON.stringify(hidden))

  this.redirect(this.request.body.directory || '/')
})

router.post('/show', body, function* hide(next) {
  if (!this.state.is_admin)
    return yield next

  let directory = this.request.body.directory
  let ipath = join(IMAGES, directory)

  let hidden = undefined
  try {
    hidden = JSON.parse(fs.readFileSync(join(ipath, '.hidden')))
  } catch(_) {
    hidden = {}
  }

  hidden[this.request.body.file] = false
  fs.writeFileSync(join(ipath, '.hidden'), JSON.stringify(hidden))

  this.redirect(this.request.body.directory || '/')
})

router.get(/^\/(?!(?:preview|img))(.*)?/, function* dir(next) {
  yield next

  let isdir = function (f) {
    let stats = fs.statSync(f.path)
    return f.name !== 'orginals' && stats.isDirectory()
  }

  let ispic = function (f) {
    return /.*(png|jpe?g|gif)$/.test(f.path)
  }

  let directory = this.state.directory = this.params[0] || ''
  if (directory.length) directory += '/'

  let ipath = join(IMAGES, directory)
  let files = yield cofs.readdir(ipath)

  let hidden = undefined
  try {
    hidden = JSON.parse(fs.readFileSync(join(ipath, '.hidden')))
  } catch(_) {
    hidden = {}
  }

  files = files
    .filter((file) => file[0] !== '.')
    .filter((file) => this.state.is_admin || !hidden[file])
    .map((file) => ({ name: file, rpath: `${directory}${file}`, path: join(ipath, file), hidden: hidden[file] }))

  this.state.files = files
    .filter((file) => ispic(file))
  this.state.dirs = files
    .filter((file) => isdir(file))

  this.state.crumbs = [{ name: '(root)', path: '/' }]
  if (~directory.indexOf('/')) {
    let here = ''
    let parts = directory.split('/').filter((part) => part.length)
    this.state.crumbs = this.state.crumbs.concat(parts.map((i) => ({ name: i, path: here += '/' + i })))
  }
  this.state.crumbs[this.state.crumbs.length - 1].active = true

  yield this.render('index')
})

router.get(/^\/img\/(.*)/, function* full(next) {
  yield next

  let path = join(IMAGES, this.params[0])
  this.set('Cache-Control', 'public,no-transform,max-age=31536000')
  this.type = extname(path)
  this.body = fs.createReadStream(path)
})

router.get(/^\/preview\/(.*)/
, function* validate(next) {
  let directory = dirname(join(PREVIEWS, this.params[0]));

  try {
    fs.statSync(directory)
  } catch(_) {
    mkdirp.sync(directory)
  }

  try {
    let hidden = join(IMAGES, '.hidden')
    fs.statSync(hidden)
  } catch(_) {
    fs.writeFileSync(hidden, '{}')
  }

  yield next
}
, function* preview(next) {
  yield next

  let preview = join(PREVIEWS, this.params[0])
  try {
    fs.statSync(preview)
  } catch(_) {
    yield easyimage.rescrop({
      src: join(IMAGES, this.params[0]),
      dst: join(PREVIEWS, this.params[0]),
      width: 500, height: 500,
      cropwidth: 256, cropheight: 256,
      x: 0, y: 0
    })
  }

  this.set('Cache-Control', 'public,no-transform,max-age=31536000')
  this.type = extname(preview)
  this.body = fs.createReadStream(preview)
})

app.use(views('views', {
  default: 'jade'
}))

app.use(router.routes())

app.listen(3000, function () {
  console.log('app listening on port 3000')
  console.log('images directory: %s', IMAGES)
})
