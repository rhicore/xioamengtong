const { BACKEND_MODE } = require('./config');

const backend = BACKEND_MODE === 'http'
  ? require('./backend/http')
  : require('./backend/cloudbase');

const fetchOrderDetails = backend.getOrder;
const uploadOrderImages = backend.saveOrderImages;

module.exports = {
  fetchOrderDetails,
  uploadOrderImages
};
