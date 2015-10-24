'use strict'

const fs = require('fs'),
      cofs = require('co-fs'),
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
  let start = process.hrtime()
  yield next

  let end = process.hrtime(start)
  let totalsec = end[0] + end[1] / 1e9
  this.set('X-Response-Time', totalsec + 'ms')
})

//app.use(function* contentLength(next) {
//  yield next
//
//  if (!this.body) return
//    this.set('Content-Length', this.body.length)
//})

router.get('/', function* body(next) {
  yield next

  let isdir = function (f) {
    let stats = fs.statSync(f.path)
    return stats.isDirectory()
  }

  let files = yield cofs.readdir(IMAGES)
  files = files
    .filter((file) => file[0] !== '.')
    .map((file) => ({ name: file, path: join(IMAGES, file) }))

  this.state.files = files
    .filter((file) => !isdir(file))
  this.state.dirs = files
    .filter((file) => isdir(file))

  this.state.crumbs = [{ name: '(root)', path: '/' }]

  yield this.render('index')
})

router.get(/^\/img\/(.*)/, function* full(next) {
  yield next

  let path = join(IMAGES, this.params[0])
  this.type = extname(path)
  this.body = fs.createReadStream(path)
})

router.get(/^\/preview\/(.*)/, function* preview(next) {
  yield next

  let directory = dirname(join(PREVIEWS, this.params[0]));

  try {
    fs.statSync(directory)
  } catch (ex) {
    fs.mkdirSync(directory);
  }

  let thumb = yield easyimage.rescrop({
    src: join(IMAGES, this.params[0]),
    dst: join(PREVIEWS, this.params[0]),
    width: 500, height: 500,
    cropwidth: 256, cropheight: 256,
    x: 0, y: 0
  })

  this.type = thumb.type
  this.body = fs.createReadStream(thumb.path)
})

router.get(/\/(.*)/, function* dir(next) {
  if (~this.path.indexOf('/preview') || ~this.path.indexOf('/img')) return

  yield next

  let isdir = function (f) {
    let stats = fs.statSync(f.path)
    return stats.isDirectory()
  }

  let path = join(IMAGES, this.params[0])
  let files = yield cofs.readdir(path)
  files = files
    .filter((file) => file[0] !== '.')
    .map((file) => ({ name: `${this.params[0]}/${file}`, path: join(path, file) }))

  this.state.files = files
    .filter((file) => !isdir(file))
  this.state.dirs = files
    .filter((file) => isdir(file))

  let here = ''
  let parts = this.params[0].split('/').map((i) => ({ name: i, path: here += '/' + i }))
  parts[parts.length - 1].active = true
  this.state.crumbs = [{ name: '(root)', path: '/' }].concat(parts)

  yield this.render('index')
})

app.use(views('views', {
  default: 'jade'
}))

app.use(router.routes())

app.listen(3000, function () {
  console.log('app listening on port 3000')
  console.log('images directory: %s', IMAGES)
})
