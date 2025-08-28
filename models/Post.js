const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  caption: {
    type: String,
    required: true,
    maxlength: 1000
  },
  mediaURL: {
    type: String,
    required: true
  },
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    default: 'image'
  },
  tags: [{
    name: String,
    type: {
      type: String,
      enum: ['brand', 'category', 'year', 'rarity', 'color', 'size']
    }
  }],
  likes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    text: {
      type: String,
      required: true,
      maxlength: 500
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  userCollection: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserCollection'
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'followers'],
    default: 'public'
  }
}, {
  timestamps: true
});

// Index for better query performance
postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ 'tags.name': 1 });
postSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);