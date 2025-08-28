const express = require('express');
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const Post = require('../models/Post');
const UserCollection = require('../models/UserCollection');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/posts/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and videos are allowed.'));
    }
  }
});

// @route   GET /api/posts/feed
// @desc    Get user's feed
// @access  Private
router.get('/feed', auth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get posts from followed users and own posts
    const followingIds = [...req.user.following, req.user._id];
    
    const posts = await Post.find({
      user: { $in: followingIds },
      visibility: { $in: ['public', 'followers'] }
    })
    .populate('user', 'username avatar')
    .populate('userCollection', 'name category')
    .populate('comments.user', 'username avatar')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    res.json({
      success: true,
      posts,
      pagination: {
        page,
        limit,
        hasNext: posts.length === limit
      }
    });

  } catch (error) {
    next(error);
  }
});

// @route   GET /api/posts/explore
// @desc    Get trending/explore posts
// @access  Public
router.get('/explore', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { category, brand, search } = req.query;

    let query = { visibility: 'public' };
    
    // Add filters
    if (category) {
      query['tags.name'] = category;
    }
    
    if (brand) {
      query['tags'] = {
        $elemMatch: {
          name: new RegExp(brand, 'i'),
          type: 'brand'
        }
      };
    }
    
    if (search) {
      query.$or = [
        { caption: { $regex: search, $options: 'i' } },
        { 'tags.name': { $regex: search, $options: 'i' } }
      ];
    }

    const posts = await Post.find(query)
      .populate('user', 'username avatar')
      .populate('userCollection', 'name category')
      .sort({ 'likes.length': -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      posts,
      pagination: {
        page,
        limit,
        hasNext: posts.length === limit
      }
    });

  } catch (error) {
    next(error);
  }
});

// @route   POST /api/posts
// @desc    Create a new post
// @access  Private
router.post('/', [
  auth,
  upload.single('media'),
  body('caption')
    .notEmpty()
    .withMessage('Caption is required')
    .isLength({ max: 1000 })
    .withMessage('Caption must be less than 1000 characters'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('userCollection')
    .optional()
    .isMongoId()
    .withMessage('Invalid collection ID')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Media file is required'
      });
    }

    const { caption, tags, userCollection, visibility } = req.body;

    // Verify collection ownership if specified
    if (userCollection) {
      const collection = await UserCollection.findOne({
        _id: userCollection,
        user: req.user._id
      });
      
      if (!collection) {
        return res.status(404).json({
          success: false,
          message: 'Collection not found or not owned by user'
        });
      }
    }

    // Process tags
    let processedTags = [];
    if (tags && Array.isArray(tags)) {
      processedTags = tags.map(tag => ({
        name: tag.name,
        type: tag.type || 'general'
      }));
    }

    // Determine media type
    const mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';

    const post = new Post({
      user: req.user._id,
      caption,
      mediaURL: `/uploads/posts/${req.file.filename}`,
      mediaType,
      tags: processedTags,
      userCollection: userCollection || undefined,
      visibility: visibility || 'public'
    });

    await post.save();

    // Add post to collection if specified
    if (userCollection) {
      await UserCollection.findByIdAndUpdate(userCollection, {
        $push: { items: post._id }
      });
    }

    // Populate the post for response
    await post.populate('user', 'username avatar');
    await post.populate('userCollection', 'name category');

    // Emit real-time notification to followers
    const followers = req.user.followers;
    followers.forEach(followerId => {
      req.io.to(`user_${followerId}`).emit('new_post', {
        type: 'new_post',
        user: req.user.username,
        userId: req.user._id,
        postId: post._id,
        message: `${req.user.username} posted a new item`
      });
    });

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      post
    });

  } catch (error) {
    next(error);
  }
});

// @route   POST /api/posts/:id/like
// @desc    Like/unlike a post
// @access  Private
router.post('/:id/like', auth, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const likeIndex = post.likes.findIndex(
      like => like.user.toString() === req.user._id.toString()
    );

    let isLiked;
    if (likeIndex > -1) {
      // Unlike
      post.likes.splice(likeIndex, 1);
      isLiked = false;
    } else {
      // Like
      post.likes.push({ user: req.user._id });
      isLiked = true;
    }

    await post.save();

    // Emit real-time update
    req.io.to(`post_${post._id}`).emit('post_like', {
      postId: post._id,
      userId: req.user._id,
      username: req.user.username,
      isLiked,
      totalLikes: post.likes.length
    });

    // Notify post owner if it's not their own post
    if (post.user.toString() !== req.user._id.toString() && isLiked) {
      req.io.to(`user_${post.user}`).emit('notification', {
        type: 'like',
        user: req.user.username,
        userId: req.user._id,
        postId: post._id,
        message: `${req.user.username} liked your post`
      });
    }

    res.json({
      success: true,
      isLiked,
      totalLikes: post.likes.length
    });

  } catch (error) {
    next(error);
  }
});

// @route   POST /api/posts/:id/comment
// @desc    Add a comment to a post
// @access  Private
router.post('/:id/comment', [
  auth,
  body('text')
    .notEmpty()
    .withMessage('Comment text is required')
    .isLength({ max: 500 })
    .withMessage('Comment must be less than 500 characters')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const newComment = {
      user: req.user._id,
      text: req.body.text,
      createdAt: new Date()
    };

    post.comments.push(newComment);
    await post.save();

    // Populate the new comment
    await post.populate('comments.user', 'username avatar');
    const populatedComment = post.comments[post.comments.length - 1];

    // Emit real-time update
    req.io.to(`post_${post._id}`).emit('post_comment', {
      postId: post._id,
      comment: populatedComment,
      totalComments: post.comments.length
    });

    // Notify post owner if it's not their own post
    if (post.user.toString() !== req.user._id.toString()) {
      req.io.to(`user_${post.user}`).emit('notification', {
        type: 'comment',
        user: req.user.username,
        userId: req.user._id,
        postId: post._id,
        message: `${req.user.username} commented on your post`
      });
    }

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      comment: populatedComment,
      totalComments: post.comments.length
    });

  } catch (error) {
    next(error);
  }
});

// @route   GET /api/posts/:id
// @desc    Get a single post
// @access  Public
router.get('/:id', async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('user', 'username avatar')
      .populate('userCollection', 'name category')
      .populate('comments.user', 'username avatar');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    res.json({
      success: true,
      post
    });

  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/posts/:id
// @desc    Delete a post
// @access  Private
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user owns the post
    if (post.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this post'
      });
    }

    // Remove post from collection if it belongs to one
    if (post.userCollection) {
      await UserCollection.findByIdAndUpdate(post.userCollection, {
        $pull: { items: post._id }
      });
    }

    await Post.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;