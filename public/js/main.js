// Main JavaScript file for FlexBase
class FlexBase {
    constructor() {
        this.socket = null;
        this.currentUser = window.currentUser;
        this.notifications = [];
        this.init();
    }
    
    init() {
        this.initSocket();
        this.initEventListeners();
        this.loadNotifications();
    }
    
    // Socket.IO initialization
    initSocket() {
        if (this.currentUser) {
            const token = this.getToken();
            if (token) {
                this.socket = io({
                    auth: { token: token }
                });
                
                this.socket.on('connect', () => {
                    console.log('Connected to FlexBase server');
                });
                
                this.socket.on('disconnect', () => {
                    console.log('Disconnected from FlexBase server');
                });
                
                this.socket.on('notification', (notification) => {
                    this.showNotification(notification);
                });
                
                this.socket.on('post_like', (data) => {
                    this.updateLikeCount(data.postId, data.totalLikes, data.isLiked);
                });
                
                this.socket.on('post_comment', (data) => {
                    this.updateCommentCount(data.postId, data.totalComments);
                    this.addCommentToPost(data.postId, data.comment);
                });
                
                this.socket.on('new_post', (notification) => {
                    this.showNotification(notification);
                });
            }
        }
    }
    
    // Event listeners
    initEventListeners() {
        // Search functionality
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', this.debounce(this.handleSearch.bind(this), 300));
            document.addEventListener('click', (e) => {
                if (!searchInput.contains(e.target) && !document.getElementById('search-results').contains(e.target)) {
                    this.hideSearchResults();
                }
            });
        }
        
        // Modal close on overlay click
        const modalOverlay = document.getElementById('modal-overlay');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    this.hideModal();
                }
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));
        
        // Infinite scroll
        window.addEventListener('scroll', this.throttle(this.handleScroll.bind(this), 100));
    }
    
    // Search functionality
    async handleSearch(event) {
        const query = event.target.value.trim();
        const resultsContainer = document.getElementById('search-results');
        
        if (!query) {
            this.hideSearchResults();
            return;
        }
        
        if (query.length < 2) return;
        
        try {
            const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}&limit=5`);
            const data = await response.json();
            
            if (data.success && data.users.length > 0) {
                this.showSearchResults(data.users);
            } else {
                this.showNoSearchResults();
            }
        } catch (error) {
            console.error('Search error:', error);
        }
    }
    
    showSearchResults(users) {
        const resultsContainer = document.getElementById('search-results');
        resultsContainer.innerHTML = users.map(user => `
            <div class="search-result-item" onclick="window.location.href='/profile/${user._id}'">
                <img src="${user.avatar}" alt="${user.username}" class="search-avatar">
                <div class="search-info">
                    <span class="search-username">@${user.username}</span>
                    <span class="search-bio">${user.bio || 'Collector'}</span>
                </div>
            </div>
        `).join('');
        resultsContainer.classList.remove('hidden');
    }
    
    showNoSearchResults() {
        const resultsContainer = document.getElementById('search-results');
        resultsContainer.innerHTML = '<div class="search-no-results">No users found</div>';
        resultsContainer.classList.remove('hidden');
    }
    
    hideSearchResults() {
        const resultsContainer = document.getElementById('search-results');
        if (resultsContainer) {
            resultsContainer.classList.add('hidden');
        }
    }
    
    // Post interactions
    async toggleLike(postId) {
        if (!this.currentUser) {
            this.showNotification({ type: 'error', message: 'Please log in to like posts' });
            return;
        }
        
        const likeBtn = document.querySelector(`[data-post-id="${postId}"] .like-btn`);
        const wasLiked = likeBtn.classList.contains('active');
        
        // Optimistic update
        likeBtn.classList.toggle('active');
        const likeCount = likeBtn.querySelector('.like-count');
        const currentCount = parseInt(likeCount.textContent);
        likeCount.textContent = wasLiked ? currentCount - 1 : currentCount + 1;
        
        try {
            const response = await fetch(`/api/posts/${postId}/like`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getToken()}`,
                    'Content-Type': 'application/json',
                }
            });
            
            const data = await response.json();
            
            if (!data.success) {
                // Revert optimistic update
                likeBtn.classList.toggle('active');
                likeCount.textContent = currentCount;
                this.showNotification({ type: 'error', message: data.message });
            }
        } catch (error) {
            // Revert optimistic update
            likeBtn.classList.toggle('active');
            likeCount.textContent = currentCount;
            this.showNotification({ type: 'error', message: 'Failed to update like' });
        }
    }
    
    updateLikeCount(postId, totalLikes, isLiked) {
        const postCard = document.querySelector(`[data-post-id="${postId}"]`);
        if (postCard) {
            const likeBtn = postCard.querySelector('.like-btn');
            const likeCount = postCard.querySelector('.like-count');
            
            if (isLiked) {
                likeBtn.classList.add('active');
            } else {
                likeBtn.classList.remove('active');
            }
            
            likeCount.textContent = totalLikes;
        }
    }
    
    toggleComments(postId) {
        const commentsSection = document.getElementById(`comments-${postId}`);
        if (commentsSection) {
            commentsSection.classList.toggle('hidden');
            
            // Join/leave post room for real-time updates
            if (this.socket) {
                if (commentsSection.classList.contains('hidden')) {
                    this.socket.emit('leave_post', postId);
                } else {
                    this.socket.emit('join_post', postId);
                }
            }
        }
    }
    
    async addComment(event, postId) {
        event.preventDefault();
        
        if (!this.currentUser) {
            this.showNotification({ type: 'error', message: 'Please log in to comment' });
            return;
        }
        
        const form = event.target;
        const input = form.querySelector('input');
        const text = input.value.trim();
        
        if (!text) return;
        
        const submitBtn = form.querySelector('button');
        submitBtn.disabled = true;
        
        try {
            const response = await fetch(`/api/posts/${postId}/comment`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text })
            });
            
            const data = await response.json();
            
            if (data.success) {
                input.value = '';
                this.updateCommentCount(postId, data.totalComments);
            } else {
                this.showNotification({ type: 'error', message: data.message });
            }
        } catch (error) {
            this.showNotification({ type: 'error', message: 'Failed to add comment' });
        } finally {
            submitBtn.disabled = false;
        }
    }
    
    updateCommentCount(postId, totalComments) {
        const postCard = document.querySelector(`[data-post-id="${postId}"]`);
        if (postCard) {
            const commentCount = postCard.querySelector('.comment-count');
            commentCount.textContent = totalComments;
        }
    }
    
    addCommentToPost(postId, comment) {
        const commentsList = document.querySelector(`#comments-${postId} .comments-list`);
        if (commentsList) {
            const commentElement = this.createCommentElement(comment);
            commentsList.appendChild(commentElement);
        }
    }
    
    createCommentElement(comment) {
        const div = document.createElement('div');
        div.className = 'comment-item';
        div.innerHTML = `
            <img src="${comment.user.avatar}" alt="${comment.user.username}" class="comment-avatar">
            <div class="comment-content">
                <span class="comment-username">@${comment.user.username}</span>
                <p class="comment-text">${comment.text}</p>
                <span class="comment-time">just now</span>
            </div>
        `;
        return div;
    }
    
    // User interactions
    async followUser(userId) {
        if (!this.currentUser) {
            this.showNotification({ type: 'error', message: 'Please log in to follow users' });
            return;
        }
        
        try {
            const response = await fetch(`/api/users/${userId}/follow`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getToken()}`,
                    'Content-Type': 'application/json',
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification({ 
                    type: 'success', 
                    message: data.message 
                });
                
                // Update follow button if on profile page
                const followBtn = document.querySelector('.follow-btn');
                if (followBtn) {
                    if (data.isFollowing) {
                        followBtn.textContent = 'Unfollow';
                        followBtn.classList.replace('btn-primary', 'btn-secondary');
                    } else {
                        followBtn.textContent = 'Follow';
                        followBtn.classList.replace('btn-secondary', 'btn-primary');
                    }
                }
            } else {
                this.showNotification({ type: 'error', message: data.message });
            }
        } catch (error) {
            this.showNotification({ type: 'error', message: 'Failed to follow/unfollow user' });
        }
    }
    
    // Authentication
    async logout() {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getToken()}`,
                    'Content-Type': 'application/json',
                }
            });
            
            localStorage.removeItem('token');
            this.currentUser = null;
            
            if (this.socket) {
                this.socket.disconnect();
            }
            
            window.location.href = '/';
        } catch (error) {
            console.error('Logout error:', error);
            // Logout locally even if server request fails
            localStorage.removeItem('token');
            window.location.href = '/';
        }
    }
    
    getToken() {
        return localStorage.getItem('token') || this.getCookie('token');
    }
    
    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }
    
    // Notifications
    showNotification(notification) {
        const container = document.getElementById('notifications');
        if (!container) return;
        
        const notificationEl = document.createElement('div');
        notificationEl.className = `notification ${notification.type || 'info'}`;
        notificationEl.innerHTML = `
            <div class="notification-content">
                <div class="notification-icon">
                    ${this.getNotificationIcon(notification.type)}
                </div>
                <div class="notification-message">${notification.message}</div>
            </div>
            <button class="notification-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        container.appendChild(notificationEl);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notificationEl.parentElement) {
                notificationEl.remove();
            }
        }, 5000);
    }
    
    getNotificationIcon(type) {
        const icons = {
            success: '<i class="fas fa-check-circle" style="color: var(--success);"></i>',
            error: '<i class="fas fa-exclamation-circle" style="color: var(--error);"></i>',
            warning: '<i class="fas fa-exclamation-triangle" style="color: var(--warning);"></i>',
            info: '<i class="fas fa-info-circle" style="color: var(--primary);"></i>',
            like: '<i class="fas fa-heart" style="color: var(--error);"></i>',
            comment: '<i class="fas fa-comment" style="color: var(--primary);"></i>',
            follow: '<i class="fas fa-user-plus" style="color: var(--secondary);"></i>',
            new_post: '<i class="fas fa-camera" style="color: var(--accent);"></i>'
        };
        return icons[type] || icons.info;
    }
    
    loadNotifications() {
        // Load any persisted notifications from localStorage if needed
        const saved = localStorage.getItem('flexbase_notifications');
        if (saved) {
            try {
                this.notifications = JSON.parse(saved);
            } catch (error) {
                console.error('Error loading notifications:', error);
            }
        }
    }
    
    // Modals
    showModal(content, title = '') {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.innerHTML = `
                <div class="modal-content">
                    ${title ? `<div class="modal-header"><h3>${title}</h3><button onclick="flexbase.hideModal()"><i class="fas fa-times"></i></button></div>` : ''}
                    <div class="modal-body">${content}</div>
                </div>
            `;
            overlay.classList.add('active');
        }
    }
    
    hideModal() {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => {
                overlay.innerHTML = '';
            }, 300);
        }
    }
    
    // File upload handling
    handleFileUpload(input, preview, callback) {
        input.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;
            
            // Validate file type
            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/mov'];
            if (!allowedTypes.includes(file.type)) {
                this.showNotification({ 
                    type: 'error', 
                    message: 'Invalid file type. Please select an image or video.' 
                });
                return;
            }
            
            // Validate file size (10MB limit)
            if (file.size > 10 * 1024 * 1024) {
                this.showNotification({ 
                    type: 'error', 
                    message: 'File is too large. Maximum size is 10MB.' 
                });
                return;
            }
            
            // Show preview
            const reader = new FileReader();
            reader.onload = (e) => {
                if (preview) {
                    if (file.type.startsWith('video/')) {
                        preview.innerHTML = `<video src="${e.target.result}" controls></video>`;
                    } else {
                        preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
                    }
                }
                
                if (callback) {
                    callback(file, e.target.result);
                }
            };
            reader.readAsDataURL(file);
        });
    }
    
    // Utility functions
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
    
    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);
        
        if (diffInSeconds < 60) {
            return 'just now';
        } else if (diffInSeconds < 3600) {
            const minutes = Math.floor(diffInSeconds / 60);
            return `${minutes}m ago`;
        } else if (diffInSeconds < 86400) {
            const hours = Math.floor(diffInSeconds / 3600);
            return `${hours}h ago`;
        } else if (diffInSeconds < 604800) {
            const days = Math.floor(diffInSeconds / 86400);
            return `${days}d ago`;
        } else {
            return date.toLocaleDateString();
        }
    }
    
    // Keyboard shortcuts
    handleKeyboardShortcuts(event) {
        // Ctrl/Cmd + K for search
        if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
            event.preventDefault();
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.focus();
            }
        }
        
        // Escape to close modals/dropdowns
        if (event.key === 'Escape') {
            this.hideModal();
            this.hideSearchResults();
        }
    }
    
    // Infinite scroll
    handleScroll() {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 1000) {
            const loadMoreBtn = document.querySelector('#load-more button');
            if (loadMoreBtn && !loadMoreBtn.disabled) {
                loadMoreBtn.click();
            }
        }
    }
}

// Global functions for template usage
window.toggleLike = (postId) => window.flexbase.toggleLike(postId);
window.toggleComments = (postId) => window.flexbase.toggleComments(postId);
window.addComment = (event, postId) => window.flexbase.addComment(event, postId);
window.followUser = (userId) => window.flexbase.followUser(userId);
window.logout = () => window.flexbase.logout();
window.showNotification = (notification) => window.flexbase.showNotification(notification);
window.updateLikeCount = (postId, totalLikes, isLiked) => window.flexbase.updateLikeCount(postId, totalLikes, isLiked);
window.updateCommentCount = (postId, totalComments) => window.flexbase.updateCommentCount(postId, totalComments);
window.addCommentToPost = (postId, comment) => window.flexbase.addCommentToPost(postId, comment);

// Initialize FlexBase when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.flexbase = new FlexBase();
});

// Additional utility functions
function sharePost(postId) {
    if (navigator.share) {
        navigator.share({
            title: 'Check out this item on FlexBase',
            url: `${window.location.origin}/post/${postId}`
        });
    } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(`${window.location.origin}/post/${postId}`)
            .then(() => {
                window.flexbase.showNotification({
                    type: 'success',
                    message: 'Post link copied to clipboard!'
                });
            })
            .catch(() => {
                window.flexbase.showNotification({
                    type: 'error',
                    message: 'Failed to copy link'
                });
            });
    }
}

function savePost(postId) {
    // Placeholder for save functionality
    window.flexbase.showNotification({
        type: 'info',
        message: 'Save feature coming soon!'
    });
}

function createPostElement(post) {
    const postEl = document.createElement('div');
    postEl.className = 'post-card';
    postEl.setAttribute('data-post-id', post._id);
    
    postEl.innerHTML = `
        <div class="post-header">
            <div class="post-user">
                <img src="${post.user.avatar}" alt="${post.user.username}" class="user-avatar">
                <div class="user-info">
                    <a href="/profile/${post.user._id}" class="username">@${post.user.username}</a>
                    <span class="post-time">${window.flexbase.formatDate(post.createdAt)}</span>
                </div>
            </div>
            ${post.userCollection ? `
                <div class="post-collection">
                    <i class="fas fa-bookmark"></i>
                    <a href="/collection/${post.userCollection._id}">${post.userCollection.name}</a>
                </div>
            ` : ''}
        </div>
        
        <div class="post-media">
            ${post.mediaType === 'video' ? `
                <video controls>
                    <source src="${post.mediaURL}" type="video/mp4">
                </video>
            ` : `
                <img src="${post.mediaURL}" alt="Post media">
            `}
        </div>
        
        <div class="post-actions">
            <button class="action-btn like-btn" onclick="toggleLike('${post._id}')">
                <i class="fas fa-heart"></i>
                <span class="like-count">${post.likes.length}</span>
            </button>
            
            <button class="action-btn comment-btn" onclick="toggleComments('${post._id}')">
                <i class="fas fa-comment"></i>
                <span class="comment-count">${post.comments.length}</span>
            </button>
            
            <button class="action-btn share-btn" onclick="sharePost('${post._id}')">
                <i class="fas fa-share"></i>
            </button>
            
            <button class="action-btn save-btn" onclick="savePost('${post._id}')">
                <i class="fas fa-bookmark"></i>
            </button>
        </div>
        
        <div class="post-content">
            <p class="post-caption">${post.caption}</p>
            
            ${post.tags && post.tags.length > 0 ? `
                <div class="post-tags">
                    ${post.tags.map(tag => `
                        <span class="tag tag-${tag.type}">
                            <i class="fas fa-tag"></i>
                            ${tag.name}
                        </span>
                    `).join('')}
                </div>
            ` : ''}
        </div>
        
        <div class="post-comments hidden" id="comments-${post._id}">
            <div class="comments-list">
                ${post.comments && post.comments.length > 0 ? post.comments.map(comment => `
                    <div class="comment-item">
                        <img src="${comment.user.avatar}" alt="${comment.user.username}" class="comment-avatar">
                        <div class="comment-content">
                            <span class="comment-username">@${comment.user.username}</span>
                            <p class="comment-text">${comment.text}</p>
                            <span class="comment-time">${window.flexbase.formatDate(comment.createdAt)}</span>
                        </div>
                    </div>
                `).join('') : ''}
            </div>
            
            ${window.currentUser ? `
                <div class="comment-form">
                    <img src="${window.currentUser.avatar}" alt="${window.currentUser.username}" class="comment-avatar">
                    <form onsubmit="addComment(event, '${post._id}')">
                        <input type="text" placeholder="Add a comment..." required>
                        <button type="submit">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </form>
                </div>
            ` : ''}
        </div>
    `;
    
    return postEl;
}

// Export for Node.js environment if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FlexBase;
}