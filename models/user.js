// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId:    { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  email:       { type: String, required: true, unique: true }
}, { timestamps: true });

// Check if the model is already compiled, otherwise compile it
module.exports = mongoose.models.User ? mongoose.models.User : mongoose.model('User', userSchema);
