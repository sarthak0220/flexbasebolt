const mongoose = require('mongoose');

const userCollectionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    maxlength: 50
  },
  description: {
    type: String,
    maxlength: 200,
    default: ''
  },
  category: {
    type: String,
    enum: ['sneakers', 'watches', 'luxury', 'art', 'cars', 'jewelry', 'other'],
    required: true
  },
  isPrivate: {
    type: Boolean,
    default: false
  },
  coverImage: {
    type: String,
    default: ''
  },
  items: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  }]
}, {
  timestamps: true
});

// Index for better query performance
userCollectionSchema.index({ user: 1 });
userCollectionSchema.index({ category: 1 });

module.exports = mongoose.model('UserCollection', userCollectionSchema);