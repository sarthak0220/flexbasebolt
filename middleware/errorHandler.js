const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  console.error('Error:', err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    let message = 'Duplicate field value entered';
    const field = Object.keys(err.keyValue)[0];
    
    if (field === 'email') {
      message = 'Email already exists';
    } else if (field === 'username') {
      message = 'Username already taken';
    }
    
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // Check if it's an API request or web request
  const isApiRequest = req.originalUrl.startsWith('/api/') || req.headers.accept?.includes('application/json');

  if (isApiRequest) {
    // API response
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Server Error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  } else {
    // Web response - render error page
    res.status(error.statusCode || 500).render('error', {
      title: 'Error',
      message: error.message || 'Something went wrong',
      statusCode: error.statusCode || 500,
      user: req.user || null
    });
  }
};

module.exports = errorHandler;