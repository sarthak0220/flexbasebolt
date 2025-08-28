const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Post = require('../models/Post');
const UserCollection = require('../models/UserCollection');
const { auth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/users/search
// @desc    Search users
// @access  Public
router.get('/search', async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const users = await User.find({
      $or: [
        { username: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    })
    .select('username avatar bio')
    .limit(parseInt(limit));

    res.json({
      success: true,
      users
    });

  } catch (error) {
    next(error);
  }
});

// @route   GET /api/users/:id
// @desc    Get user profile
// @access  Public
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('followers', 'username avatar')
      .populate('following', 'username avatar');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's posts count
    const postsCount = await Post.countDocuments({ user: user._id });
    
    // Get user's collections count
    const collectionsCount = await UserCollection.countDocuments({ user: user._id });

    // Check if current user follows this user
    let isFollowing = false;
    if (req.user) {
      isFollowing = req.user.following.includes(user._id);
    }

    res.json({
      success: true,
      user: {
        ...user.toObject(),
        postsCount,
        collectionsCount,
        followersCount: user.followers.length,
        followingCount: user.following.length,
        isFollowing
      }
    });

  } catch (error) {
    next(error);
  }
});

// @route   GET /api/users/:id/posts
// @desc    Get user's posts
// @access  Public
router.get('/:id/posts', optionalAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const skip = (page - 1) * limit;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Determine visibility based on relationship
    let visibilityFilter = ['public'];
    
    if (req.user) {
      if (req.user._id.toString() === user._id.toString()) {
        // User viewing own posts - show all
        visibilityFilter = ['public', 'private', 'followers'];
      } else if (user.followers.includes(req.user._id)) {
        // Follower viewing - show public and followers
        visibilityFilter = ['public', 'followers'];
      }
    }

    const posts = await Post.find({
      user: user._id,
      visibility: { $in: visibilityFilter }
    })
    .populate('userCollection', 'name category')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    res.json({
      success: true,
      posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasNext: posts.length === parseInt(limit)
      }
    });

  } catch (error) {
    next(error);
  }
});

// @route   GET /api/users/:id/collections
// @desc    Get user's collections
// @access  Public
router.get('/:id/collections', optionalAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Determine visibility
    let query = { user: user._id };
    
    if (!req.user || req.user._id.toString() !== user._id.toString()) {
      // Not the owner - only show public collections
      query.isPrivate = false;
    }

    const collections = await UserCollection.find(query)
      .populate('items', 'mediaURL caption')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      collections
    });

  } catch (error) {
    next(error);
  }
});

// @route   POST /api/users/:id/follow
// @desc    Follow/unfollow a user
// @access  Private
router.post('/:id/follow', auth, async (req, res, next) => {
  try {
    const userToFollow = await User.findById(req.params.id);
    
    if (!userToFollow) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (userToFollow._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot follow yourself'
      });
    }

    const currentUser = await User.findById(req.user._id);
    const isFollowing = currentUser.following.includes(userToFollow._id);

    if (isFollowing) {
      // Unfollow
      currentUser.following = currentUser.following.filter(
        id => id.toString() !== userToFollow._id.toString()
      );
      userToFollow.followers = userToFollow.followers.filter(
        id => id.toString() !== currentUser._id.toString()
      );
    } else {
      // Follow
      currentUser.following.push(userToFollow._id);
      userToFollow.followers.push(currentUser._id);

      // Send real-time notification
      req.io.to(`user_${userToFollow._id}`).emit('notification', {
        type: 'follow',
        user: currentUser.username,
        userId: currentUser._id,
        message: `${currentUser.username} started following you`
      });
    }

    await Promise.all([currentUser.save(), userToFollow.save()]);

    res.json({
      success: true,
      message: isFollowing ? 'User unfollowed' : 'User followed',
      isFollowing: !isFollowing,
      followersCount: userToFollow.followers.length
    });

  } catch (error) {
    next(error);
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', [
  auth,
  body('username')
    .optional()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('bio')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Bio must be less than 200 characters')
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

    const { username, bio, isPrivate } = req.body;
    const user = await User.findById(req.user._id);

    // Check if username is taken (if trying to change it)
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Username already taken'
        });
      }
      user.username = username;
    }

    if (bio !== undefined) user.bio = bio;
    if (isPrivate !== undefined) user.isPrivate = isPrivate;

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: user.toJSON()
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;