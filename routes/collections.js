const express = require('express');
const { body, validationResult } = require('express-validator');
const UserCollection = require('../models/UserCollection');
const Post = require('../models/Post');
const { auth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/collections
// @desc    Get user's collections
// @access  Private
router.get('/', auth, async (req, res, next) => {
  try {
    const collections = await UserCollection.find({ user: req.user._id })
      .populate('items', 'mediaURL caption createdAt')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      collections
    });

  } catch (error) {
    next(error);
  }
});

// @route   GET /api/collections/:id
// @desc    Get a single collection
// @access  Public
router.get('/:id', async (req, res, next) => {
  try {
    const collection = await UserCollection.findById(req.params.id)
      .populate('user', 'username avatar')
      .populate({
        path: 'items',
        populate: {
          path: 'user',
          select: 'username avatar'
        }
      });

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Check if collection is private
    if (collection.isPrivate && (!req.user || collection.user._id.toString() !== req.user._id.toString())) {
      return res.status(403).json({
        success: false,
        message: 'This collection is private'
      });
    }

    res.json({
      success: true,
      collection
    });

  } catch (error) {
    next(error);
  }
});

// @route   POST /api/collections
// @desc    Create a new collection
// @access  Private
router.post('/', [
  auth,
  body('name')
    .notEmpty()
    .withMessage('Collection name is required')
    .isLength({ max: 50 })
    .withMessage('Name must be less than 50 characters'),
  body('category')
    .isIn(['sneakers', 'watches', 'luxury', 'art', 'cars', 'jewelry', 'other'])
    .withMessage('Invalid category'),
  body('description')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Description must be less than 200 characters')
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

    const { name, description, category, isPrivate } = req.body;

    const collection = new UserCollection({
      user: req.user._id,
      name,
      description: description || '',
      category,
      isPrivate: isPrivate || false
    });

    await collection.save();
    await collection.populate('user', 'username avatar');

    res.status(201).json({
      success: true,
      message: 'Collection created successfully',
      collection
    });

  } catch (error) {
    next(error);
  }
});

// @route   PUT /api/collections/:id
// @desc    Update a collection
// @access  Private
router.put('/:id', [
  auth,
  body('name')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Name must be less than 50 characters'),
  body('category')
    .optional()
    .isIn(['sneakers', 'watches', 'luxury', 'art', 'cars', 'jewelry', 'other'])
    .withMessage('Invalid category'),
  body('description')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Description must be less than 200 characters')
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

    const collection = await UserCollection.findById(req.params.id);
    
    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Check ownership
    if (collection.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this collection'
      });
    }

    const updateFields = ['name', 'description', 'category', 'isPrivate'];
    updateFields.forEach(field => {
      if (req.body[field] !== undefined) {
        collection[field] = req.body[field];
      }
    });

    await collection.save();
    await collection.populate('user', 'username avatar');

    res.json({
      success: true,
      message: 'Collection updated successfully',
      collection
    });

  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/collections/:id
// @desc    Delete a collection
// @access  Private
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const collection = await UserCollection.findById(req.params.id);
    
    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Check ownership
    if (collection.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this collection'
      });
    }

    // Remove collection reference from posts
    await Post.updateMany(
      { userCollection: collection._id },
      { $unset: { userCollection: 1 } }
    );

    await UserCollection.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Collection deleted successfully'
    });

  } catch (error) {
    next(error);
  }
});

// @route   POST /api/collections/:id/add-post
// @desc    Add a post to a collection
// @access  Private
router.post('/:id/add-post', [
  auth,
  body('postId')
    .isMongoId()
    .withMessage('Invalid post ID')
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

    const collection = await UserCollection.findById(req.params.id);
    const post = await Post.findById(req.body.postId);

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user owns the collection
    if (collection.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this collection'
      });
    }

    // Check if post belongs to the user
    if (post.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Can only add your own posts to collections'
      });
    }

    // Check if post is already in collection
    if (collection.items.includes(post._id)) {
      return res.status(400).json({
        success: false,
        message: 'Post is already in this collection'
      });
    }

    // Add post to collection
    collection.items.push(post._id);
    post.userCollection = collection._id;

    await Promise.all([collection.save(), post.save()]);

    res.json({
      success: true,
      message: 'Post added to collection successfully'
    });

  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/collections/:id/remove-post/:postId
// @desc    Remove a post from a collection
// @access  Private
router.delete('/:id/remove-post/:postId', auth, async (req, res, next) => {
  try {
    const collection = await UserCollection.findById(req.params.id);
    const post = await Post.findById(req.params.postId);

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user owns the collection
    if (collection.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this collection'
      });
    }

    // Remove post from collection
    collection.items = collection.items.filter(
      item => item.toString() !== post._id.toString()
    );
    
    // Remove collection reference from post
    post.userCollection = undefined;

    await Promise.all([collection.save(), post.save()]);

    res.json({
      success: true,
      message: 'Post removed from collection successfully'
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;