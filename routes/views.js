const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const User = require('../models/User');
const Post = require('../models/Post');
const UserCollection = require('../models/UserCollection');

const router = express.Router();

// Home page
router.get('/', optionalAuth, async (req, res) => {
  if (req.user) {
    // Redirect to feed if authenticated
    return res.redirect('/feed');
  }
  
  // Show landing page for unauthenticated users
  const trendingPosts = await Post.find({ visibility: 'public' })
    .populate('user', 'username avatar')
    .sort({ 'likes.length': -1, createdAt: -1 })
    .limit(6);

  res.render('index', { 
    title: 'FlexBase - Social Platform for Collectors',
    user: null,
    trendingPosts
  });
});

// Auth pages
router.get('/login', (req, res) => {
  if (req.user) {
    return res.redirect('/feed');
  }
  res.render('auth/login', { 
    title: 'Login - FlexBase',
    user: null 
  });
});

router.get('/signup', (req, res) => {
  if (req.user) {
    return res.redirect('/feed');
  }
  res.render('auth/signup', { 
    title: 'Sign Up - FlexBase',
    user: null 
  });
});

// Main app pages (require authentication)
router.get('/feed', optionalAuth, async (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }

  try {
    const followingIds = [...req.user.following, req.user._id];
    
    const posts = await Post.find({
      user: { $in: followingIds },
      visibility: { $in: ['public', 'followers'] }
    })
    .populate('user', 'username avatar')
    .populate('userCollection', 'name category')
    .populate('comments.user', 'username avatar')
    .sort({ createdAt: -1 })
    .limit(20);

    res.render('feed', { 
      title: 'Feed - FlexBase',
      user: req.user,
      posts
    });
  } catch (error) {
    res.render('error', { 
      title: 'Error',
      message: 'Failed to load feed',
      user: req.user
    });
  }
});

router.get('/explore', optionalAuth, async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = { visibility: 'public' };
    
    if (category) {
      query['tags.name'] = category;
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
      .limit(30);

    res.render('explore', { 
      title: 'Explore - FlexBase',
      user: req.user,
      posts,
      currentCategory: category,
      currentSearch: search
    });
  } catch (error) {
    res.render('error', { 
      title: 'Error',
      message: 'Failed to load explore page',
      user: req.user
    });
  }
});

router.get('/profile/:id?', optionalAuth, async (req, res) => {
  try {
    const userId = req.params.id || (req.user ? req.user._id : null);
    
    if (!userId) {
      return res.redirect('/login');
    }

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).render('error', { 
        title: 'User Not Found',
        message: 'User not found',
        user: req.user
      });
    }

    // Get user's posts
    let visibilityFilter = ['public'];
    if (req.user) {
      if (req.user._id.toString() === user._id.toString()) {
        visibilityFilter = ['public', 'private', 'followers'];
      } else if (user.followers.includes(req.user._id)) {
        visibilityFilter = ['public', 'followers'];
      }
    }

    const posts = await Post.find({
      user: user._id,
      visibility: { $in: visibilityFilter }
    })
    .populate('userCollection', 'name category')
    .sort({ createdAt: -1 });

    // Get collections
    let collectionQuery = { user: user._id };
    if (!req.user || req.user._id.toString() !== user._id.toString()) {
      collectionQuery.isPrivate = false;
    }

    const collections = await UserCollection.find(collectionQuery)
      .populate('items', 'mediaURL caption')
      .sort({ createdAt: -1 });

    const isFollowing = req.user ? req.user.following.includes(user._id) : false;
    const isOwnProfile = req.user ? req.user._id.toString() === user._id.toString() : false;

    res.render('profile', { 
      title: `${user.username} - FlexBase`,
      user: req.user,
      profileUser: user,
      posts,
      collections,
      isFollowing,
      isOwnProfile,
      postsCount: posts.length,
      collectionsCount: collections.length,
      followersCount: user.followers.length,
      followingCount: user.following.length
    });
  } catch (error) {
    res.render('error', { 
      title: 'Error',
      message: 'Failed to load profile',
      user: req.user
    });
  }
});

router.get('/create', optionalAuth, async (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }

  try {
    const collections = await UserCollection.find({ user: req.user._id })
      .sort({ createdAt: -1 });

    res.render('create', { 
      title: 'Create Post - FlexBase',
      user: req.user,
      collections
    });
  } catch (error) {
    res.render('error', { 
      title: 'Error',
      message: 'Failed to load create page',
      user: req.user
    });
  }
});

router.get('/collections', optionalAuth, async (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }

  try {
    const collections = await UserCollection.find({ user: req.user._id })
      .populate('items', 'mediaURL caption')
      .sort({ createdAt: -1 });

    res.render('collections', { 
      title: 'My Collections - FlexBase',
      user: req.user,
      collections
    });
  } catch (error) {
    res.render('error', { 
      title: 'Error',
      message: 'Failed to load collections',
      user: req.user
    });
  }
});

router.get('/collection/:id', optionalAuth, async (req, res) => {
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
      return res.status(404).render('error', { 
        title: 'Collection Not Found',
        message: 'Collection not found',
        user: req.user
      });
    }

    // Check privacy
    if (collection.isPrivate && (!req.user || collection.user._id.toString() !== req.user._id.toString())) {
      return res.status(403).render('error', { 
        title: 'Private Collection',
        message: 'This collection is private',
        user: req.user
      });
    }

    const isOwner = req.user ? collection.user._id.toString() === req.user._id.toString() : false;

    res.render('collection-detail', { 
      title: `${collection.name} - FlexBase`,
      user: req.user,
      collection,
      isOwner
    });
  } catch (error) {
    res.render('error', { 
      title: 'Error',
      message: 'Failed to load collection',
      user: req.user
    });
  }
});

router.get('/post/:id', optionalAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('user', 'username avatar bio')
      .populate('userCollection', 'name category')
      .populate('comments.user', 'username avatar');

    if (!post) {
      return res.status(404).render('error', { 
        title: 'Post Not Found',
        message: 'Post not found',
        user: req.user
      });
    }

    const isLiked = req.user ? post.likes.some(like => like.user.toString() === req.user._id.toString()) : false;
    const isOwner = req.user ? post.user._id.toString() === req.user._id.toString() : false;

    res.render('post-detail', { 
      title: `${post.user.username}'s Post - FlexBase`,
      user: req.user,
      post,
      isLiked,
      isOwner,
      likesCount: post.likes.length,
      commentsCount: post.comments.length
    });
  } catch (error) {
    res.render('error', { 
      title: 'Error',
      message: 'Failed to load post',
      user: req.user
    });
  }
});

module.exports = router;