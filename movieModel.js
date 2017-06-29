'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var MovieSchema = new Schema({
  user_id: {type: String},
  title: {type: String}
});

module.exports = mongoose.model("Movie", MovieSchema);
