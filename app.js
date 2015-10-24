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

router.get(/^\/(?!(?:preview|img))(.*)?/, function* dir(next) {
  yield next

  let isdir = function (f) {
    let stats = fs.statSync(f.path)
    return stats.isDirectory()
  }

  let ispic = function (f) {
    return /.*(png|jpe?g|gif)$/.test(f.path)
  }

  let directory = this.params[0] || ''
  if (directory.length) directory += '/'

  let ipath = join(IMAGES, directory)
  let files = yield cofs.readdir(ipath)

  files = files
    .filter((file) => file[0] !== '.')
    .map((file) => ({ name: `${directory}${file}`, path: join(ipath, file) }))

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
