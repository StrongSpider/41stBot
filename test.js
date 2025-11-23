const assets = require('./src/api/assets.js')
const test = async function (params) {
  const r = await assets.getAssetsInformation(1389759088, {overwriteExisting: true})
  console.log(r)
}
test()