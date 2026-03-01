// ============================================
// SUPABASE CONFIGURATION
// ============================================
const SUPABASE_URL = 'https://onsyibpsaxvmlqfwccfx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DIW1oSveqXFbHOM2iiHKjg_LnpUj4CN';

// ============================================
// UTILITIES
// ============================================
const STATE_VERSION = 5;

// Logging helpers for Supabase operations
const SupabaseLog = {
    // Log remote data after fetching from server
    logRemoteData(context, data) {
        console.log(`%c[Supabase] Remote data fetched (${context})`, 'color: #4CAF50; font-weight: bold');
        console.log(JSON.stringify(data, null, 2));
    },
    
    // Log local data before saving to server
    logLocalData(context, data) {
        console.log(`%c[Supabase] Local data to save (${context})`, 'color: #2196F3; font-weight: bold');
        console.log(JSON.stringify(data, null, 2));
    },
    
    // Log Supabase errors with context
    logError(operation, errorMessage, details = null) {
        console.error(`%c[Supabase Error] ${operation}`, 'color: #f44336; font-weight: bold');
        console.error(`  Message: ${errorMessage}`);
        if (details) {
            console.error(`  Details:`, details);
        }
    }
};
const MEMBER_ROLES = ['owner', 'editor', 'viewer'];
const SAVE_DEBOUNCE_MS = 500;

function debounce(fn, delay) {
    let timeoutId;
    const debounced = function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
    debounced.cancel = () => clearTimeout(timeoutId);
    debounced.flush = function(...args) {
        clearTimeout(timeoutId);
        fn.apply(this, args);
    };
    return debounced;
}

function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ============================================
// AUTH MANAGER - Handles authentication
// ============================================
class AuthManager {
    constructor() {
        this.user = null;
        this.accessToken = null;
        this.refreshToken = null;
        this.listeners = [];
        
        // Auth modal DOM elements
        this.authModal = document.getElementById('authModal');
        this.authModalClose = document.getElementById('authModalClose');
        this.authModalTitle = document.getElementById('authModalTitle');
        this.authForm = document.getElementById('authForm');
        this.authEmail = document.getElementById('authEmail');
        this.authPassword = document.getElementById('authPassword');
        this.authError = document.getElementById('authError');
        this.authSubmit = document.getElementById('authSubmit');
        this.authSwitchText = document.getElementById('authSwitchText');
        this.authSwitchBtn = document.getElementById('authSwitchBtn');
        
        // Auth form extra fields
        this.authUserName = document.getElementById('authUserName');
        this.authNickName = document.getElementById('authNickName');
        this.authConfirmPassword = document.getElementById('authConfirmPassword');
        this.authForgotPassword = document.getElementById('authForgotPassword');
        
        // Account modal DOM elements
        this.accountModal = document.getElementById('accountModal');
        this.accountModalClose = document.getElementById('accountModalClose');
        this.accountUserName = document.getElementById('accountUserName');
        this.accountNickName = document.getElementById('accountNickName');
        this.accountEmail = document.getElementById('accountEmail');
        this.accountSyncStatus = document.getElementById('accountSyncStatus');
        this.accountSignOut = document.getElementById('accountSignOut');
        
        // Account edit elements
        this.accountUserNameInput = document.getElementById('accountUserNameInput');
        this.accountUserNameEdit = document.getElementById('accountUserNameEdit');
        this.accountNickNameInput = document.getElementById('accountNickNameInput');
        this.accountNickNameEdit = document.getElementById('accountNickNameEdit');
        this.accountPassword = document.getElementById('accountPassword');
        this.accountPasswordInputs = document.getElementById('accountPasswordInputs');
        this.accountNewPassword = document.getElementById('accountNewPassword');
        this.accountConfirmPassword = document.getElementById('accountConfirmPassword');
        this.accountPasswordEdit = document.getElementById('accountPasswordEdit');
        this.accountSaveProfile = document.getElementById('accountSaveProfile');
        
        // Auth bar (top-right text)
        this.authBarText = document.getElementById('authBarText');
        
        // Reset password modal elements
        this.resetPasswordModal = document.getElementById('resetPasswordModal');
        this.resetPasswordModalClose = document.getElementById('resetPasswordModalClose');
        this.resetPasswordForm = document.getElementById('resetPasswordForm');
        this.resetNewPassword = document.getElementById('resetNewPassword');
        this.resetConfirmPassword = document.getElementById('resetConfirmPassword');
        this.resetPasswordError = document.getElementById('resetPasswordError');
        this.resetPasswordSubmit = document.getElementById('resetPasswordSubmit');
        
        this.isSignUp = false;
        this.isEditing = false;
        this.recoveryToken = null;
        
        this.init();
    }
    
    init() {
        this.restoreSession();
        this.setupEventListeners();
        this.checkForRecoveryToken();
        this.updateUI();
    }
    
    setupEventListeners() {
        // Auth modal close
        this.authModalClose?.addEventListener('click', () => this.hideModal());
        this.authModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => this.hideModal());
        
        // Account modal close
        this.accountModalClose?.addEventListener('click', () => this.hideAccountModal());
        this.accountModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => this.hideAccountModal());
        this.accountSignOut?.addEventListener('click', () => {
            this.hideAccountModal();
            this.signOut();
        });
        
        // Account profile edit buttons
        this.accountUserNameEdit?.addEventListener('click', () => this.startEditingField('userName'));
        this.accountNickNameEdit?.addEventListener('click', () => this.startEditingField('nickName'));
        this.accountPasswordEdit?.addEventListener('click', () => this.startEditingField('password'));
        this.accountSaveProfile?.addEventListener('click', () => this.saveProfileChanges());
        
        // Enter key to save while editing
        this.accountUserNameInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveProfileChanges();
            }
        });
        this.accountNickNameInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveProfileChanges();
            }
        });
        this.accountConfirmPassword?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveProfileChanges();
            }
        });
        
        // Auth bar click (Sign in or user name)
        this.authBarText?.addEventListener('click', () => this.onAuthBarClick());
        
        // Form submit
        this.authForm?.addEventListener('submit', (e) => this.handleSubmit(e));
        
        // Switch between sign in / sign up
        this.authSwitchBtn?.addEventListener('click', () => this.toggleMode());
        
        // Forgot password
        this.authForgotPassword?.addEventListener('click', () => this.handleForgotPassword());
        
        // Reset password modal
        this.resetPasswordModalClose?.addEventListener('click', () => this.hideResetPasswordModal());
        this.resetPasswordModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => this.hideResetPasswordModal());
        this.resetPasswordForm?.addEventListener('submit', (e) => this.handleResetPasswordSubmit(e));
        
        // Password visibility toggles
        document.querySelectorAll('.password-toggle').forEach(btn => {
            btn.addEventListener('click', () => this.togglePasswordVisibility(btn));
        });
        
        // Close on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.authModal?.style.display !== 'none') {
                    this.hideModal();
                }
                if (this.accountModal?.style.display !== 'none') {
                    this.hideAccountModal();
                }
                if (this.resetPasswordModal?.style.display !== 'none') {
                    this.hideResetPasswordModal();
                }
                const memberProfileModal = document.getElementById('memberProfileModal');
                if (memberProfileModal?.style.display !== 'none') {
                    memberProfileModal.style.display = 'none';
                }
            }
        });
    }
    
    onAuthBarClick() {
        if (this.user) {
            this.showAccountModal();
        } else {
            this.isSignUp = false;
            this.showModal();
        }
    }
    
    togglePasswordVisibility(btn) {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (!input) return;
        
        if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '🙈';
            btn.classList.add('visible');
        } else {
            input.type = 'password';
            btn.textContent = '👁';
            btn.classList.remove('visible');
        }
    }
    
    setUserProfile(userId, profile) {
        if (!userId) return;
        try {
            localStorage.setItem(`familist.userProfile.${userId}`, JSON.stringify(profile));
        } catch (e) {}
    }
    
    getUserProfile(userId) {
        if (!userId) return null;
        try {
            const key = `familist.userProfile.${userId}`;
            const stored = localStorage.getItem(key);
            return stored ? JSON.parse(stored) : null;
        } catch (e) {
            return null;
        }
    }
    
    getDisplayName(userId) {
        const profile = this.getUserProfile(userId);
        return profile?.nickName || null;
    }
    
    getUserName(userId) {
        const profile = this.getUserProfile(userId);
        return profile?.userName || null;
    }
    
    showModal() {
        if (this.authModal) {
            this.authForm?.reset();
            this.updateModalMode();
            this.authModal.style.display = 'flex';
            this.authEmail?.focus();
            this.clearError();
        }
    }
    
    hideModal() {
        if (this.authModal) {
            this.authModal.style.display = 'none';
            this.authForm?.reset();
            this.clearError();
        }
    }
    
    showAccountModal() {
        if (this.accountModal && this.user) {
            const profile = this.getUserProfile(this.user.id);
            this.accountUserName.textContent = profile?.userName || '-';
            this.accountNickName.textContent = profile?.nickName || this.user.email?.split('@')[0] || '-';
            this.accountEmail.textContent = this.user.email || '-';
            this.accountSyncStatus.textContent = listManager?.syncEnabled ? 'Enabled' : 'Disabled';
            this.resetEditingState();
            this.accountModal.style.display = 'flex';
        }
    }
    
    hideAccountModal() {
        if (this.accountModal) {
            this.resetEditingState();
            this.accountModal.style.display = 'none';
        }
    }
    
    resetEditingState() {
        this.isEditing = false;
        
        if (this.accountUserName && this.accountUserNameInput) {
            this.accountUserName.style.display = '';
            this.accountUserNameInput.style.display = 'none';
            this.accountUserNameEdit.style.display = '';
        }
        if (this.accountNickName && this.accountNickNameInput) {
            this.accountNickName.style.display = '';
            this.accountNickNameInput.style.display = 'none';
            this.accountNickNameEdit.style.display = '';
        }
        if (this.accountPassword && this.accountPasswordInputs) {
            this.accountPassword.style.display = '';
            this.accountPasswordInputs.style.display = 'none';
            this.accountPasswordEdit.style.display = '';
            this.accountNewPassword.value = '';
            this.accountConfirmPassword.value = '';
        }
        if (this.accountSaveProfile) {
            this.accountSaveProfile.style.display = 'none';
        }
    }
    
    startEditingField(fieldName) {
        if (fieldName === 'userName') {
            const currentValue = this.accountUserName.textContent;
            this.accountUserNameInput.value = currentValue === '-' ? '' : currentValue;
            this.accountUserName.style.display = 'none';
            this.accountUserNameInput.style.display = '';
            this.accountUserNameEdit.style.display = 'none';
            this.accountUserNameInput.focus();
        } else if (fieldName === 'nickName') {
            const currentValue = this.accountNickName.textContent;
            this.accountNickNameInput.value = currentValue === '-' ? '' : currentValue;
            this.accountNickName.style.display = 'none';
            this.accountNickNameInput.style.display = '';
            this.accountNickNameEdit.style.display = 'none';
            this.accountNickNameInput.focus();
        } else if (fieldName === 'password') {
            this.accountNewPassword.value = '';
            this.accountConfirmPassword.value = '';
            this.accountPassword.style.display = 'none';
            this.accountPasswordInputs.style.display = '';
            this.accountPasswordEdit.style.display = 'none';
            this.accountNewPassword.focus();
        }
        
        this.isEditing = true;
        if (this.accountSaveProfile) {
            this.accountSaveProfile.style.display = '';
        }
    }
    
    async saveProfileChanges() {
        if (!this.user) return;
        
        const profile = this.getUserProfile(this.user.id) || {};
        let hasChanges = false;
        let passwordChanged = false;
        
        if (this.accountUserNameInput.style.display !== 'none') {
            const newUserName = this.accountUserNameInput.value.trim();
            if (newUserName && newUserName !== profile.userName) {
                profile.userName = newUserName;
                hasChanges = true;
            }
        }
        
        if (this.accountNickNameInput.style.display !== 'none') {
            const newNickName = this.accountNickNameInput.value.trim();
            if (newNickName && newNickName !== profile.nickName) {
                profile.nickName = newNickName;
                hasChanges = true;
            }
        }
        
        // Handle password change
        if (this.accountPasswordInputs?.style.display !== 'none') {
            const newPassword = this.accountNewPassword?.value;
            const confirmPassword = this.accountConfirmPassword?.value;
            
            if (newPassword || confirmPassword) {
                if (newPassword !== confirmPassword) {
                    alert('Passwords do not match.');
                    this.accountNewPassword.focus();
                    return;
                }
                if (newPassword.length < 6) {
                    alert('Password must be at least 6 characters.');
                    this.accountNewPassword.focus();
                    return;
                }
                
                try {
                    await this.updatePassword(newPassword);
                    passwordChanged = true;
                } catch (err) {
                    alert('Failed to update password: ' + err.message);
                    return;
                }
            }
        }
        
        if (hasChanges) {
            const oldProfile = this.getUserProfile(this.user.id) || {};
            
            // Save locally first (so syncProfileToSupabase can read it)
            this.setUserProfile(this.user.id, profile);
            
            // Sync to Supabase to validate uniqueness
            if (typeof listManager !== 'undefined' && listManager.syncEnabled) {
                try {
                    await listManager.syncProfileToSupabase();
                } catch (err) {
                    // Restore old profile on error
                    this.setUserProfile(this.user.id, oldProfile);
                    alert(err.message);
                    return;
                }
            }
            
            this.updateUI();
            
            // Update all members created by this user across all lists
            if (typeof listManager !== 'undefined') {
                listManager.updateCreatorInfo(this.user.id, profile.userName, profile.nickName, this.user.email);
            }
        }
        
        if (passwordChanged) {
            alert('Password updated successfully.');
        }
        
        this.accountUserName.textContent = profile.userName || '-';
        this.accountNickName.textContent = profile.nickName || '-';
        this.resetEditingState();
    }
    
    async updatePassword(newPassword) {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            method: 'PUT',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password: newPassword })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to update password');
        }
        
        return await response.json();
    }
    
    toggleMode() {
        this.isSignUp = !this.isSignUp;
        this.updateModalMode();
        this.clearError();
    }
    
    updateModalMode() {
        if (this.isSignUp) {
            this.authModalTitle.textContent = 'Sign Up';
            this.authSubmit.textContent = 'Sign Up';
            this.authSwitchText.textContent = 'Already have an account?';
            this.authSwitchBtn.textContent = 'Sign In';
            this.authUserName?.setAttribute('required', 'required');
            this.authNickName?.setAttribute('required', 'required');
            this.authConfirmPassword?.setAttribute('required', 'required');
            this.authForm?.classList.add('signup-mode');
        } else {
            this.authModalTitle.textContent = 'Sign In';
            this.authSubmit.textContent = 'Sign In';
            this.authSwitchText.textContent = "Don't have an account?";
            this.authSwitchBtn.textContent = 'Sign Up';
            this.authUserName?.removeAttribute('required');
            this.authNickName?.removeAttribute('required');
            this.authConfirmPassword?.removeAttribute('required');
            this.authForm?.classList.remove('signup-mode');
        }
    }
    
    showError(message) {
        if (this.authError) {
            this.authError.textContent = message;
            this.authError.style.display = 'block';
            this.authError.style.color = '#dc2626';
        }
    }
    
    clearError() {
        if (this.authError) {
            this.authError.textContent = '';
            this.authError.style.display = 'none';
        }
    }
    
    async handleSubmit(e) {
        e.preventDefault();
        
        const email = this.authEmail?.value?.trim();
        const password = this.authPassword?.value;
        const confirmPassword = this.authConfirmPassword?.value;
        const userName = this.authUserName?.value?.trim();
        const nickName = this.authNickName?.value?.trim();
        
        if (!email || !password) {
            this.showError('Please enter email and password');
            return;
        }
        
        if (password.length < 6) {
            this.showError('Password must be at least 6 characters');
            return;
        }
        
        if (this.isSignUp) {
            if (!confirmPassword) {
                this.showError('Please confirm your password');
                return;
            }
            if (password !== confirmPassword) {
                this.showError('Passwords do not match');
                return;
            }
            if (!userName) {
                this.showError('Please enter your full name');
                return;
            }
            if (!nickName) {
                this.showError('Please enter your nick name');
                return;
            }
        }
        
        this.authSubmit.disabled = true;
        this.authSubmit.textContent = this.isSignUp ? 'Creating account...' : 'Signing in...';
        
        try {
            if (this.isSignUp) {
                await this.signUp(email, password, userName, nickName);
            } else {
                await this.signIn(email, password);
            }
            
            if (this.user) {
                // Only set profile during sign-up (when user provides the data)
                // For sign-in, loadFromSupabase will handle loading the remote profile
                if (this.isSignUp) {
                    const profile = { userName, nickName };
                    this.setUserProfile(this.user.id, profile);
                    
                    // Sync profile to Supabase immediately to validate username uniqueness
                    if (typeof listManager !== 'undefined') {
                        try {
                            await listManager.syncProfileToSupabase();
                        } catch (err) {
                            this.showError(err.message);
                            // Clear local profile since it failed
                            this.setUserProfile(this.user.id, null);
                            return;
                        }
                    }
                }
                // Note: Don't set default profile on sign-in - loadFromSupabase will handle it
            }
            
            this.hideModal();
            this.updateUI(); // Show email/name immediately while loading profile
            this.notifyListeners('SIGNED_IN');
        } catch (error) {
            this.showError(error.message || 'Authentication failed');
        } finally {
            this.authSubmit.disabled = false;
            this.updateModalMode();
        }
    }
    
    async signUp(email, password, userName, nickName) {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                email, 
                password,
                data: { user_name: userName, nick_name: nickName }
            }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            const errorMsg = data.error_description || data.msg || data.message || data.error || 'Sign up failed';
            if (errorMsg.toLowerCase().includes('already registered') || 
                errorMsg.toLowerCase().includes('already exists') ||
                errorMsg.toLowerCase().includes('email already') ||
                errorMsg.toLowerCase().includes('user already')) {
                throw new Error('An account with this email already exists. Please sign in instead.');
            }
            if (errorMsg.toLowerCase().includes('rate limit')) {
                throw new Error('Too many attempts. Please wait a few minutes and try again.');
            }
            throw new Error(errorMsg);
        }
        
        const user = data.user || data;
        const identities = user.identities;
        
        if (Array.isArray(identities) && identities.length === 0) {
            throw new Error('An account with this email already exists. Please sign in instead.');
        }
        
        if (data.access_token) {
            this.setSession(data);
        }
        
        return data;
    }
    
    async signIn(email, password) {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error_description || data.msg || 'Sign in failed');
        }
        
        this.setSession(data);
        return data;
    }
    
    async signOut() {
        if (this.accessToken) {
            try {
                await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${this.accessToken}`,
                    },
                });
            } catch (e) {
            }
        }
        
        this.clearSession();
    }
    
    async handleForgotPassword() {
        const email = this.authEmail?.value?.trim();
        
        if (!email) {
            this.showError('Please enter your email address first');
            this.authEmail?.focus();
            return;
        }
        
        try {
            this.authForgotPassword.disabled = true;
            this.authForgotPassword.textContent = 'Sending...';
            
            await this.resetPassword(email);
            
            this.clearError();
            this.showSuccess('Password reset email sent! Check your inbox.');
        } catch (error) {
            this.showError(error.message || 'Failed to send reset email');
        } finally {
            this.authForgotPassword.disabled = false;
            this.authForgotPassword.textContent = 'Forgot password?';
        }
    }
    
    async resetPassword(email) {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            const errorMsg = data.error_description || data.msg || data.message || 'Failed to send reset email';
            if (errorMsg.toLowerCase().includes('rate limit')) {
                throw new Error('Too many attempts. Please wait a few minutes and try again.');
            }
            throw new Error(errorMsg);
        }
        
        return data;
    }
    
    showSuccess(message) {
        if (this.authError) {
            this.authError.textContent = message;
            this.authError.style.display = 'block';
            this.authError.style.color = '#16a34a';
        }
    }
    
    checkForRecoveryToken() {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const type = params.get('type');
        
        if (accessToken && type === 'recovery') {
            this.recoveryToken = accessToken;
            if (refreshToken) {
                this.refreshToken = refreshToken;
            }
            window.history.replaceState(null, '', window.location.pathname);
            this.showResetPasswordModal();
        }
    }
    
    showResetPasswordModal() {
        if (this.resetPasswordModal) {
            this.resetPasswordForm?.reset();
            this.clearResetPasswordError();
            this.resetPasswordModal.style.display = 'flex';
            this.resetNewPassword?.focus();
        }
    }
    
    hideResetPasswordModal() {
        if (this.resetPasswordModal) {
            this.resetPasswordModal.style.display = 'none';
            this.resetPasswordForm?.reset();
            this.recoveryToken = null;
        }
    }
    
    showResetPasswordError(message) {
        if (this.resetPasswordError) {
            this.resetPasswordError.textContent = message;
            this.resetPasswordError.style.display = 'block';
            this.resetPasswordError.style.color = '#dc2626';
        }
    }
    
    showResetPasswordSuccess(message) {
        if (this.resetPasswordError) {
            this.resetPasswordError.textContent = message;
            this.resetPasswordError.style.display = 'block';
            this.resetPasswordError.style.color = '#16a34a';
        }
    }
    
    clearResetPasswordError() {
        if (this.resetPasswordError) {
            this.resetPasswordError.textContent = '';
            this.resetPasswordError.style.display = 'none';
        }
    }
    
    async handleResetPasswordSubmit(e) {
        e.preventDefault();
        
        const newPassword = this.resetNewPassword?.value;
        const confirmPassword = this.resetConfirmPassword?.value;
        
        if (!newPassword || !confirmPassword) {
            this.showResetPasswordError('Please fill in both password fields');
            return;
        }
        
        if (newPassword.length < 6) {
            this.showResetPasswordError('Password must be at least 6 characters');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            this.showResetPasswordError('Passwords do not match');
            return;
        }
        
        if (!this.recoveryToken) {
            this.showResetPasswordError('Invalid or expired reset link. Please request a new one.');
            return;
        }
        
        this.resetPasswordSubmit.disabled = true;
        this.resetPasswordSubmit.textContent = 'Updating...';
        
        try {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                method: 'PUT',
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${this.recoveryToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ password: newPassword }),
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error_description || data.msg || data.message || 'Failed to update password');
            }
            
            if (data.id) {
                this.user = data;
                this.accessToken = this.recoveryToken;
                
                localStorage.setItem('supabase.auth.token', JSON.stringify({
                    access_token: this.recoveryToken,
                    refresh_token: this.refreshToken,
                    user: data,
                    expires_at: Date.now() + (3600 * 1000),
                }));
                
                this.updateUI();
                this.showResetPasswordSuccess('Password updated successfully!');
                
                setTimeout(() => {
                    this.hideResetPasswordModal();
                    this.notifyListeners('SIGNED_IN');
                }, 1500);
            } else {
                this.showResetPasswordSuccess('Password updated successfully! You can now sign in.');
                
                setTimeout(() => {
                    this.hideResetPasswordModal();
                    this.showModal();
                }, 2000);
            }
            
        } catch (error) {
            this.showResetPasswordError(error.message || 'Failed to update password');
        } finally {
            this.resetPasswordSubmit.disabled = false;
            this.resetPasswordSubmit.textContent = 'Update Password';
        }
    }
    
    setSession(data) {
        this.accessToken = data.access_token;
        this.refreshToken = data.refresh_token;
        this.user = data.user;
        
        localStorage.setItem('supabase.auth.token', JSON.stringify({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            user: data.user,
            expires_at: Date.now() + (data.expires_in * 1000),
        }));
        
        // Note: Don't call updateUI() here - let loadFromSupabase() do it after
        // loading the profile, so we don't briefly show the wrong name
    }
    
    clearSession() {
        this.accessToken = null;
        this.refreshToken = null;
        this.user = null;
        localStorage.removeItem('supabase.auth.token');
        this.updateUI();
        this.notifyListeners('SIGNED_OUT');
    }
    
    restoreSession() {
        try {
            const stored = localStorage.getItem('supabase.auth.token');
            if (stored) {
                const data = JSON.parse(stored);
                if (data.expires_at > Date.now()) {
                    this.accessToken = data.access_token;
                    this.refreshToken = data.refresh_token;
                    this.user = data.user;
                } else if (data.refresh_token) {
                    this.refreshToken = data.refresh_token;
                    this.refreshSession();
                }
            }
        } catch (e) {
        }
    }
    
    async refreshSession() {
        if (!this.refreshToken) return false;
        
        try {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ refresh_token: this.refreshToken }),
            });
            
            if (response.ok) {
                const data = await response.json();
                this.setSession(data);
                return true;
            } else {
                this.clearSession();
                return false;
            }
        } catch (e) {
            this.clearSession();
            return false;
        }
    }
    
    // Check if token is expired or about to expire (within 60 seconds)
    isTokenExpired() {
        try {
            const stored = localStorage.getItem('supabase.auth.token');
            if (!stored) return true;
            const data = JSON.parse(stored);
            return data.expires_at < (Date.now() + 60000); // 60 second buffer
        } catch {
            return true;
        }
    }
    
    // Ensure we have a valid token, refreshing if needed
    async ensureValidToken() {
        if (this.isTokenExpired() && this.refreshToken) {
            return await this.refreshSession();
        }
        return this.accessToken != null;
    }
    
    updateUI() {
        if (!this.authBarText) return;
        
        const joinSection = document.getElementById('joinListSection');
        
        if (this.user) {
            const displayName = this.getDisplayName(this.user.id) || this.user.email?.split('@')[0] || 'You';
            this.authBarText.textContent = displayName;
            this.authBarText.title = 'Click for account info';
            if (joinSection) joinSection.style.display = '';
        } else {
            this.authBarText.textContent = 'Sign in';
            this.authBarText.title = 'Sign in to sync your lists';
            if (joinSection) joinSection.style.display = 'none';
        }
    }
    
    isAuthenticated() {
        return !!this.user;
    }
    
    getUser() {
        return this.user;
    }
    
    getUserId() {
        return this.user?.id || null;
    }
    
    subscribe(callback) {
        this.listeners.push(callback);
        return {
            unsubscribe: () => {
                this.listeners = this.listeners.filter(cb => cb !== callback);
            }
        };
    }
    
    notifyListeners(event) {
        this.listeners.forEach(cb => {
            try {
                cb(event, this.user);
            } catch (e) {
            }
        });
    }
}

// Global auth manager instance
let authManager = null;

// ============================================
// LIST MANAGER - Manages multiple lists
// ============================================
class ListManager {
    constructor() {
        this.lists = this.loadState();
        this.currentListId = null;
        this.showArchived = false;
        this.storageHealthy = true;
        this.syncEnabled = true;
        this.syncStatus = 'idle'; // 'idle', 'syncing', 'synced', 'error'
        
        this.listManagerView = document.getElementById('listManagerView');
        this.listEditorView = document.getElementById('listEditorView');
        this.listsContainer = document.getElementById('listsContainer');
        this.newListInput = document.getElementById('newListInput');
        this.createListButton = document.getElementById('createListButton');
        this.joinListInput = document.getElementById('joinListInput');
        this.joinListButton = document.getElementById('joinListButton');
        this.menuButton = document.getElementById('menuButton');
        this.menuDropdown = document.getElementById('menuDropdown');
        this.backToListsBtn = document.getElementById('backToListsBtn');
        this.listTitle = document.getElementById('listTitle');
        this.showActiveBtn = document.getElementById('showActiveBtn');
        this.showArchivedBtn = document.getElementById('showArchivedBtn');
        
        // Autocomplete for list names
        this.listAutocompleteList = document.getElementById('listAutocompleteList');
        this.listAutocompleteHighlightIndex = -1;
        this.listAutocompleteSuggestions = [];
        
        // Unsaved changes modal
        this.unsavedChangesModal = document.getElementById('unsavedChangesModal');
        this.unsavedSaveBtn = document.getElementById('unsavedSaveBtn');
        this.unsavedDiscardBtn = document.getElementById('unsavedDiscardBtn');
        this.unsavedCancelBtn = document.getElementById('unsavedCancelBtn');
        
        // Sync conflict modal
        this.syncConflictModal = document.getElementById('syncConflictModal');
        this.syncUpdateBtn = document.getElementById('syncUpdateBtn');
        this.syncKeepBtn = document.getElementById('syncKeepBtn');
        this.pendingRemoteList = null;
        this.pendingRemoteSnapshot = null;
        
        // Data corruption modal
        this.dataCorruptionModal = document.getElementById('dataCorruptionModal');
        this.corruptionDetails = document.getElementById('corruptionDetails');
        this.corruptionFixBtn = document.getElementById('corruptionFixBtn');
        this.corruptionIgnoreBtn = document.getElementById('corruptionIgnoreBtn');
        
        this.listEditor = null;
        
        this.init();
    }
    
    init() {
        this.createListButton.addEventListener('click', () => this.createList());
        this.newListInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (this.listAutocompleteHighlightIndex >= 0 && this.listAutocompleteSuggestions.length > 0) {
                    e.preventDefault();
                    this.selectListAutocompleteSuggestion(this.listAutocompleteHighlightIndex);
                } else {
                    this.hideListAutocomplete();
                    this.createList();
                }
            }
        });
        
        // Join list
        this.joinListButton.addEventListener('click', () => this.joinList());
        this.joinListInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.joinList();
            }
        });
        
        // Menu toggle
        this.menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu();
        });
        
        // Menu item clicks
        this.menuDropdown.addEventListener('click', (e) => {
            const menuItem = e.target.closest('[role="menuitem"]');
            if (menuItem) {
                this.handleMenuClick(menuItem.id);
            }
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.menuButton.contains(e.target) && !this.menuDropdown.contains(e.target)) {
                this.closeMenu();
            }
        });
        
        // Close menu on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.menuDropdown.classList.contains('visible')) {
                this.closeMenu();
                this.menuButton.focus();
            }
        });
        
        this.backToListsBtn.addEventListener('click', () => this.showListManager());
        
        // Autocomplete for list names
        this.newListInput.addEventListener('input', () => this.onListAutocompleteInput());
        this.newListInput.addEventListener('keydown', (e) => this.onListAutocompleteKeydown(e));
        this.newListInput.addEventListener('blur', () => {
            setTimeout(() => this.hideListAutocomplete(), 150);
        });
        this.newListInput.addEventListener('focus', () => {
            if (this.newListInput.value.trim().length > 0) {
                this.onListAutocompleteInput();
            }
        });
        this.listAutocompleteList.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const item = e.target.closest('.autocomplete-item');
            if (item) {
                const index = parseInt(item.dataset.index, 10);
                this.selectListAutocompleteSuggestion(index);
            }
        });
        
        // View toggle buttons (tablist pattern)
        this.showActiveBtn.addEventListener('click', () => this.setViewMode(false));
        this.showArchivedBtn.addEventListener('click', () => this.setViewMode(true));
        this.setupTablistKeyboard(this.showActiveBtn.parentElement, [this.showActiveBtn, this.showArchivedBtn], (index) => {
            this.setViewMode(index === 1);
        });
        
        // Event delegation for lists container
        this.listsContainer.addEventListener('click', (e) => this.handleListsClick(e));
        
        this.updateListManagerVisibility();
        this.renderLists();
        
        // Check URL for list parameter and open if valid
        this.checkUrlAndOpenList();
    }
    
    handleListsClick(e) {
        const listItem = e.target.closest('[data-list-id]');
        if (!listItem) return;
        
        const listId = listItem.dataset.listId;
        
        if (e.target.closest('.list-name')) {
            this.openList(listId);
        } else if (e.target.closest('.list-menu-btn')) {
            this.toggleListMenu(listItem);
        } else if (e.target.closest('.list-menu-item')) {
            const action = e.target.closest('.list-menu-item').dataset.action;
            this.closeAllListMenus();
            this.handleListMenuAction(listId, action);
        } else if (e.target.closest('.list-restore-btn')) {
            this.restoreList(listId);
        } else if (e.target.closest('.list-delete-btn')) {
            this.permanentlyDeleteList(listId);
        }
    }
    
    toggleListMenu(listItem) {
        const dropdown = listItem.querySelector('.list-menu-dropdown');
        const isOpen = dropdown.classList.contains('open');
        
        this.closeAllListMenus();
        
        if (!isOpen) {
            dropdown.classList.add('open');
            
            // Use requestAnimationFrame to ensure dropdown is rendered
            requestAnimationFrame(() => {
                const rect = dropdown.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                
                // Check if menu goes below viewport (with 10px buffer)
                if (rect.bottom > viewportHeight - 10) {
                    dropdown.classList.add('open-above');
                }
            });
            
            document.addEventListener('click', this.closeMenuOnOutsideClick);
        }
    }
    
    closeAllListMenus() {
        document.querySelectorAll('.list-menu-dropdown.open').forEach(menu => {
            menu.classList.remove('open', 'open-above');
        });
        document.removeEventListener('click', this.closeMenuOnOutsideClick);
    }
    
    closeMenuOnOutsideClick = (e) => {
        if (!e.target.closest('.list-menu-container')) {
            this.closeAllListMenus();
        }
    }
    
    handleListMenuAction(listId, action) {
        switch (action) {
            case 'export':
                this.exportList(listId);
                break;
            case 'share':
                this.shareList(listId);
                break;
            case 'copyToken':
                this.copyShareToken(listId);
                break;
            case 'duplicate':
                this.duplicateList(listId);
                break;
            case 'rename':
                this.startRenameList(listId);
                break;
            case 'archive':
                this.archiveList(listId);
                break;
            case 'delete':
                this.permanentlyDeleteList(listId);
                break;
        }
    }
    
    copyShareToken(listId) {
        const list = this.lists.find(l => l.id === listId);
        if (!list || !list.shareToken) {
            alert('No share code available for this list.');
            return;
        }
        
        navigator.clipboard.writeText(list.shareToken).then(() => {
            alert('Share code copied to clipboard!');
        }).catch(() => {
            prompt('Copy this share code:', list.shareToken);
        });
    }
    
    setViewMode(showArchived) {
        this.showArchived = showArchived;
        this.showActiveBtn.classList.toggle('active', !showArchived);
        this.showArchivedBtn.classList.toggle('active', showArchived);
        this.showActiveBtn.setAttribute('aria-selected', !showArchived);
        this.showArchivedBtn.setAttribute('aria-selected', showArchived);
        this.showActiveBtn.setAttribute('tabindex', showArchived ? '-1' : '0');
        this.showArchivedBtn.setAttribute('tabindex', showArchived ? '0' : '-1');
        this.renderLists();
    }
    
    // === MENU ===
    
    toggleMenu() {
        const isVisible = this.menuDropdown.classList.contains('visible');
        if (isVisible) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }
    
    openMenu() {
        this.menuDropdown.classList.add('visible');
        this.menuButton.setAttribute('aria-expanded', 'true');
    }
    
    closeMenu() {
        this.menuDropdown.classList.remove('visible');
        this.menuButton.setAttribute('aria-expanded', 'false');
    }
    
    handleMenuClick(menuItemId) {
        this.closeMenu();
        
        switch (menuItemId) {
            case 'menuImport':
                this.importList();
                break;
        }
    }
    
    // === LIST NAME AUTOCOMPLETE ===
    
    getListAutocompleteSuggestions(query) {
        if (!query || query.length < 1) return [];
        
        const lowerQuery = query.toLowerCase();
        const frequencyMap = new Map();
        
        for (const list of this.lists) {
            const name = list.name.trim();
            const lowerName = name.toLowerCase();
            
            if (lowerName.includes(lowerQuery)) {
                const key = lowerName;
                const existing = frequencyMap.get(key);
                if (existing) {
                    existing.count++;
                } else {
                    frequencyMap.set(key, { text: name, count: 1 });
                }
            }
        }
        
        const suggestions = Array.from(frequencyMap.values())
            .sort((a, b) => {
                const aStartsWith = a.text.toLowerCase().startsWith(lowerQuery);
                const bStartsWith = b.text.toLowerCase().startsWith(lowerQuery);
                if (aStartsWith && !bStartsWith) return -1;
                if (!aStartsWith && bStartsWith) return 1;
                if (b.count !== a.count) return b.count - a.count;
                return a.text.localeCompare(b.text);
            })
            .slice(0, 8);
        
        return suggestions;
    }
    
    onListAutocompleteInput() {
        const query = this.newListInput.value.trim();
        this.listAutocompleteSuggestions = this.getListAutocompleteSuggestions(query);
        
        if (this.listAutocompleteSuggestions.length === 0) {
            this.hideListAutocomplete();
            return;
        }
        
        this.renderListAutocomplete(query);
        this.showListAutocomplete();
    }
    
    onListAutocompleteKeydown(e) {
        if (!this.listAutocompleteList.classList.contains('visible')) return;
        
        const maxIndex = this.listAutocompleteSuggestions.length - 1;
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.listAutocompleteHighlightIndex = Math.min(this.listAutocompleteHighlightIndex + 1, maxIndex);
                this.updateListAutocompleteHighlight();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.listAutocompleteHighlightIndex = Math.max(this.listAutocompleteHighlightIndex - 1, -1);
                this.updateListAutocompleteHighlight();
                break;
            case 'Escape':
                e.preventDefault();
                this.hideListAutocomplete();
                break;
            case 'Tab':
                if (this.listAutocompleteSuggestions.length > 0) {
                    e.preventDefault();
                    const indexToSelect = this.listAutocompleteHighlightIndex >= 0 
                        ? this.listAutocompleteHighlightIndex 
                        : 0;
                    this.selectListAutocompleteSuggestion(indexToSelect);
                }
                break;
        }
    }
    
    renderListAutocomplete(query) {
        const lowerQuery = query.toLowerCase();
        this.listAutocompleteList.innerHTML = this.listAutocompleteSuggestions.map((suggestion, index) => {
            const text = this.escapeHtml(suggestion.text);
            const highlightedText = this.highlightListMatch(text, lowerQuery);
            const frequencyLabel = suggestion.count > 1 ? `${suggestion.count}×` : '';
            
            return `
                <li class="autocomplete-item${index === this.listAutocompleteHighlightIndex ? ' highlighted' : ''}" 
                    data-index="${index}" 
                    role="option"
                    aria-selected="${index === this.listAutocompleteHighlightIndex}">
                    <span class="autocomplete-item-text">${highlightedText}</span>
                    ${frequencyLabel ? `<span class="autocomplete-item-frequency">${frequencyLabel}</span>` : ''}
                </li>
            `;
        }).join('');
    }
    
    highlightListMatch(text, query) {
        const lowerText = text.toLowerCase();
        const index = lowerText.indexOf(query);
        if (index === -1) return text;
        
        const before = text.substring(0, index);
        const match = text.substring(index, index + query.length);
        const after = text.substring(index + query.length);
        
        return `${before}<mark>${match}</mark>${after}`;
    }
    
    showListAutocomplete() {
        this.listAutocompleteList.classList.add('visible');
        this.newListInput.setAttribute('aria-expanded', 'true');
    }
    
    hideListAutocomplete() {
        this.listAutocompleteList.classList.remove('visible');
        this.listAutocompleteList.innerHTML = '';
        this.listAutocompleteHighlightIndex = -1;
        this.listAutocompleteSuggestions = [];
        this.newListInput.setAttribute('aria-expanded', 'false');
    }
    
    updateListAutocompleteHighlight() {
        const items = this.listAutocompleteList.querySelectorAll('.autocomplete-item');
        items.forEach((item, index) => {
            const isHighlighted = index === this.listAutocompleteHighlightIndex;
            item.classList.toggle('highlighted', isHighlighted);
            item.setAttribute('aria-selected', isHighlighted);
        });
        
        if (this.listAutocompleteHighlightIndex >= 0 && items[this.listAutocompleteHighlightIndex]) {
            items[this.listAutocompleteHighlightIndex].scrollIntoView({ block: 'nearest' });
        }
    }
    
    selectListAutocompleteSuggestion(index) {
        if (index < 0 || index >= this.listAutocompleteSuggestions.length) return;
        
        const suggestion = this.listAutocompleteSuggestions[index];
        this.newListInput.value = suggestion.text;
        this.hideListAutocomplete();
        this.newListInput.focus();
    }
    
    setupTablistKeyboard(container, tabs, onSelect) {
        container.addEventListener('keydown', (e) => {
            const currentIndex = tabs.findIndex(tab => tab === document.activeElement);
            if (currentIndex === -1) return;
            
            let newIndex = currentIndex;
            
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                newIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                newIndex = currentIndex === tabs.length - 1 ? 0 : currentIndex + 1;
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(currentIndex);
                return;
            } else if (e.key === 'Home') {
                e.preventDefault();
                newIndex = 0;
            } else if (e.key === 'End') {
                e.preventDefault();
                newIndex = tabs.length - 1;
            } else {
                return;
            }
            
            tabs[newIndex].focus();
            onSelect(newIndex);
        });
    }
    
    checkUrlAndOpenList() {
        const params = new URLSearchParams(window.location.search);
        const listId = params.get('list');
        
        if (listId) {
            const list = this.lists.find(l => l.id === listId);
            if (list) {
                this.openList(listId);
            }
        }
    }
    
    // === STATE PERSISTENCE ===
    
    getStorageKey() {
        const userId = authManager?.getUserId();
        return userId ? `allLists.${userId}` : null;
    }
    
    reloadForUser() {
        this.lists = this.loadState();
        this.currentListId = null;
        this.listEditorView.style.display = 'none';
        this.listManagerView.style.display = 'block';
        this.updateListManagerVisibility();
        this.renderLists();
    }
    
    updateListManagerVisibility() {
        const isSignedIn = authManager?.isAuthenticated();
        const inputSection = document.getElementById('listManagerInputSection');
        const viewToggle = document.getElementById('listManagerViewToggle');
        if (inputSection) inputSection.style.display = isSignedIn ? '' : 'none';
        if (viewToggle) viewToggle.style.display = isSignedIn ? '' : 'none';
    }
    
    loadState() {
        if (!authManager?.isAuthenticated()) {
            return [];
        }
        
        let lists = [];
        let needsSave = false;
        const storageKey = this.getStorageKey();
        if (!storageKey) return [];
        
        const stored = localStorage.getItem(storageKey);
        if (stored) {
            try {
                const data = JSON.parse(stored);
                const result = this.migrateState(data);
                lists = result.lists;
                needsSave = result.migrated;
            } catch (err) {
                localStorage.removeItem(storageKey);
                return [];
            }
        } else {
            // Migrate from legacy 'allLists' (pre-multi-user) on first sign-in
            const legacyStored = localStorage.getItem('allLists');
            if (legacyStored) {
                try {
                    const data = JSON.parse(legacyStored);
                    const result = this.migrateState(data);
                    lists = result.lists;
                    needsSave = true;
                    localStorage.removeItem('allLists');
                } catch (err) {
                    localStorage.removeItem('allLists');
                }
            }
            // Migrate from legacy single-list format (pre-versioning)
            if (lists.length === 0) {
                const oldMembers = localStorage.getItem('members');
                const oldItems = localStorage.getItem('shoppingList');
                
                if (oldMembers || oldItems) {
                    try {
                        const legacyData = {
                            version: 0,
                            lists: [{
                                id: generateUUID(),
                                name: 'My List',
                                members: oldMembers ? JSON.parse(oldMembers) : [
                                    { id: 'noam', name: 'Noam' },
                                    { id: 'koby', name: 'Koby' }
                                ],
                                items: oldItems ? JSON.parse(oldItems) : []
                            }]
                        };
                        const result = this.migrateState(legacyData);
                        lists = result.lists;
                        needsSave = true;
                        localStorage.removeItem('members');
                        localStorage.removeItem('shoppingList');
                    } catch (err) {
                        localStorage.removeItem('members');
                        localStorage.removeItem('shoppingList');
                        return [];
                    }
                }
            }
        }
        
        // Always validate before render
        const validated = this.validateAndRepairLists(lists);
        if (JSON.stringify(validated) !== JSON.stringify(lists)) {
            lists = validated;
            needsSave = true;
        }
        
        // Save only if migration or validation made changes
        if (needsSave) {
            this.lists = lists;
            this.saveState();
        }
        
        return lists;
    }
    
    migrateState(data) {
        const originalVersion = data.version ?? 0;
        let version = originalVersion;
        let lists = data.lists ?? data; // Handle pre-versioned format (raw array)
        
        // Ensure lists is an array
        if (!Array.isArray(lists)) {
            lists = [];
        }
        
        // Migration: version 0 -> 1 (add UUIDs to all entities)
        if (version < 1) {
            lists = lists.map(list => {
                // Generate UUID for list if needed
                const listId = this.isUUID(list.id) ? list.id : generateUUID();
                
                // Migrate members and track ID mappings
                const memberIdMap = {};
                const members = (list.members || []).map(member => {
                    const oldId = member.id;
                    const newId = this.isUUID(oldId) ? oldId : generateUUID();
                    memberIdMap[oldId] = newId;
                    return { ...member, id: newId };
                });
                
                // Migrate items and update member references
                const items = (list.items || []).map(item => {
                    const itemId = this.isUUID(item.id) ? item.id : generateUUID();
                    
                    // Remap quantity keys from old member IDs to new UUIDs
                    const quantity = {};
                    if (item.quantity) {
                        Object.keys(item.quantity).forEach(oldMemberId => {
                            const newMemberId = memberIdMap[oldMemberId] || oldMemberId;
                            quantity[newMemberId] = item.quantity[oldMemberId];
                        });
                    }
                    
                    // Remap done keys from old member IDs to new UUIDs
                    const done = {};
                    if (item.done) {
                        Object.keys(item.done).forEach(oldMemberId => {
                            const newMemberId = memberIdMap[oldMemberId] || oldMemberId;
                            done[newMemberId] = item.done[oldMemberId];
                        });
                    }
                    
                    return { ...item, id: itemId, quantity, done };
                });
                
                return { ...list, id: listId, members, items };
            });
            
            version = 1;
        }
        
        // Migration: version 1 -> 2 (add member roles)
        if (version < 2) {
            lists = lists.map(list => {
                const members = (list.members || []).map((member, index) => {
                    // First member becomes owner, rest become editors
                    const role = member.role || (index === 0 ? 'owner' : 'editor');
                    return { ...member, role };
                });
                return { ...list, members };
            });
            version = 2;
        }
        
        // Migration: version 2 -> 3 (add timestamps)
        if (version < 3) {
            const now = new Date().toISOString();
            lists = lists.map(list => ({
                ...list,
                createdAt: list.createdAt || now,
                updatedAt: list.updatedAt || now
            }));
            version = 3;
        }
        
        // Migration: version 3 -> 4 (per-user archiving)
        if (version < 4) {
            const userId = authManager?.getUserId();
            lists = lists.map(list => {
                const newList = { ...list };
                // Convert old archived boolean to per-user archived object
                if (list.archived && userId) {
                    newList.archivedByUsers = { [userId]: true };
                }
                // Remove old properties
                delete newList.archived;
                delete newList.archivedAt;
                return newList;
            });
            version = 4;
        }
        
        // Migration: version 4 -> 5 (add ownerId and visibility)
        if (version < 5) {
            const userId = authManager?.getUserId();
            lists = lists.map(list => {
                const newList = { ...list };
                // Set ownerId from first owner member or current user
                if (!newList.ownerId) {
                    const ownerMember = (list.members || []).find(m => m.role === 'owner');
                    newList.ownerId = ownerMember?.createdBy || userId || null;
                }
                // Set default visibility
                if (!newList.visibility) {
                    newList.visibility = 'private';
                }
                return newList;
            });
            version = 5;
        }
        
        return {
            lists,
            migrated: version !== originalVersion
        };
    }
    
    validateAndRepairLists(lists) {
        return lists.map(list => {
            let members = list.members || [];
            let items = list.items || [];
            
            // 1. Ensure at least one member exists
            if (members.length === 0) {
                members = [{
                    id: generateUUID(),
                    name: 'me',
                    role: 'owner'
                }];
            }
            
            // 2. Ensure members have unique UUIDs (deduplicate)
            const seenMemberIds = new Set();
            members = members.filter(member => {
                if (!member.id || seenMemberIds.has(member.id)) {
                    return false;
                }
                seenMemberIds.add(member.id);
                return true;
            });
            
            // Regenerate UUIDs for members without valid IDs
            members = members.map(member => {
                if (!member.id || !this.isUUID(member.id)) {
                    return { ...member, id: generateUUID() };
                }
                return member;
            });
            
            // 3. Ensure exactly one owner exists
            const owners = members.filter(m => m.role === 'owner');
            if (owners.length === 0) {
                // No owner - promote first member to owner
                if (members.length > 0) {
                    members[0] = { ...members[0], role: 'owner' };
                }
            } else if (owners.length > 1) {
                // Multiple owners - keep only the first one as owner
                let foundFirst = false;
                members = members.map(member => {
                    if (member.role === 'owner') {
                        if (!foundFirst) {
                            foundFirst = true;
                            return member;
                        }
                        return { ...member, role: 'editor' };
                    }
                    return member;
                });
            }
            
            // 4. Ensure no duplicate item IDs
            const seenItemIds = new Set();
            items = items.filter(item => {
                if (!item.id || seenItemIds.has(item.id)) {
                    return false;
                }
                seenItemIds.add(item.id);
                return true;
            });
            
            // Regenerate UUIDs for items without valid IDs
            items = items.map(item => {
                if (!item.id || !this.isUUID(item.id)) {
                    return { ...item, id: generateUUID() };
                }
                return item;
            });
            
            return { ...list, members, items };
        });
    }
    
    isUUID(id) {
        if (typeof id !== 'string') return false;
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    }
    
    saveState() {
        if (!this.storageHealthy) {
            return false;
        }
        
        const storageKey = this.getStorageKey();
        if (!storageKey) return false;
        
        const state = {
            version: STATE_VERSION,
            lists: this.lists
        };

        try {
            localStorage.setItem(storageKey, JSON.stringify(state));
            // Note: Supabase sync is now manual via Save button - no auto-sync here
            return true;
        } catch (err) {
            SupabaseLog.logError('Save state', err.message);
            this.handleStorageError();
            return false;
        }
    }
    
    // Save to localStorage only (without triggering Supabase sync)
    saveStateToLocalStorageOnly() {
        if (!this.storageHealthy) return false;
        
        const storageKey = this.getStorageKey();
        if (!storageKey) return false;
        
        const state = {
            version: STATE_VERSION,
            lists: this.lists
        };

        try {
            localStorage.setItem(storageKey, JSON.stringify(state));
            return true;
        } catch (err) {
            return false;
        }
    }
    
    // === SUPABASE SYNC ===
    
    enableSync() {
        this.syncEnabled = true;
    }
    
    disableSync() {
        this.syncEnabled = false;
    }
    
    getAuthHeaders() {
        const headers = {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
        };
        
        if (authManager?.accessToken) {
            headers['Authorization'] = `Bearer ${authManager.accessToken}`;
        } else {
            headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
        }
        
        return headers;
    }
    
    // Authenticated fetch with automatic token refresh on 401
    async authenticatedFetch(url, options = {}) {
        // Ensure we have a valid token before making the request
        if (authManager?.isTokenExpired()) {
            const refreshed = await authManager.refreshSession();
            if (!refreshed) {
                throw new Error('Session expired. Please sign in again.');
            }
        }
        
        // Make the request with current auth headers
        options.headers = { ...this.getAuthHeaders(), ...options.headers };
        let response = await fetch(url, options);
        
        // If we get a 401, try refreshing the token once and retry
        if (response.status === 401 && authManager?.refreshToken) {
            const refreshed = await authManager.refreshSession();
            if (refreshed) {
                // Update headers with new token and retry
                options.headers = { ...this.getAuthHeaders(), ...options.headers };
                response = await fetch(url, options);
            } else {
                throw new Error('Session expired. Please sign in again.');
            }
        }
        
        return response;
    }
    
    // ---- PROFILE SYNC ----
    
    async syncProfileToSupabase() {
        const userId = authManager?.getUserId();
        if (!userId) return;
        
        const profile = authManager.getUserProfile(userId);
        if (!profile) return;
        
        // Skip if user_name is missing (required by NOT NULL constraint)
        if (!profile.userName) {
            return;
        }
        
        const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
            method: 'PATCH',
            headers: {
                ...this.getAuthHeaders(),
                'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
                user_name: profile.userName,
                nick_name: profile.nickName || null
            }),
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            if (errorText.includes('23505') || errorText.includes('duplicate') || errorText.includes('unique')) {
                throw new Error('Username already taken. Please choose a different one.');
            }
            throw new Error('Failed to save profile');
        }
    }
    
    async loadProfileFromSupabase() {
        const userId = authManager?.getUserId();
        if (!userId) return null;
        
        try {
            const response = await fetch(
                `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`,
                { headers: this.getAuthHeaders() }
            );
            
            if (response.ok) {
                const profiles = await response.json();
                if (profiles && profiles.length > 0) {
                    return {
                        userName: profiles[0].user_name,
                        nickName: profiles[0].nick_name
                    };
                }
            }
        } catch (err) {
            SupabaseLog.logError('Fetch profile', err.message);
        }
        return null;
    }
    
    // ---- MEMBERS SYNC ----
    
    async syncMemberToSupabase(listId, member) {
        const userId = authManager?.getUserId();
        if (!userId) return;
        
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/members`, {
                method: 'POST',
                headers: {
                    ...this.getAuthHeaders(),
                    'Prefer': 'resolution=merge-duplicates',
                },
                body: JSON.stringify({
                    id: member.id,
                    list_id: listId,
                    user_id: member.createdBy || userId,
                    name: member.name
                }),
            });
        } catch (err) {
            SupabaseLog.logError('Save member', err.message);
        }
    }
    
    // ---- MAIN SYNC FUNCTIONS ----
    
    async syncToSupabase() {
        if (!authManager?.isAuthenticated()) return;
        
        this.syncStatus = 'syncing';
        
        // Refresh token before sync to ensure it's valid
        try {
            await authManager.refreshSession();
        } catch (err) {
            // Continue with current token
        }
        
        try {
            await this.syncProfileToSupabase();
            
            for (const list of this.lists) {
                await this.syncListToSupabase(list);
            }
            
            this.syncStatus = 'synced';
        } catch (err) {
            SupabaseLog.logError('Save to Supabase', err.message);
            this.syncStatus = 'error';
        }
    }
    
    async syncListToSupabase(list) {
        const userId = authManager?.getUserId();
        if (!userId) return;
        
        // Log local data being saved to server
        SupabaseLog.logLocalData(list.name, {
            members: (list.members || []).map(m => m.name),
            items: (list.items || []).map(i => ({
                text: i.text,
                archived: i.archived || false,
                comment: i.comment || '',
                quantities: Object.entries(i.quantity || {}).map(([mid, qty]) => {
                    const member = (list.members || []).find(m => m.id === mid);
                    return `${member?.name || 'unknown'}:${qty}`;
                }),
                done: Object.entries(i.done || {}).map(([mid, d]) => {
                    const member = (list.members || []).find(m => m.id === mid);
                    return `${member?.name || 'unknown'}:${d}`;
                })
            }))
        });
        
        // Determine if user is owner
        const isOwnerById = list.ownerId === userId;
        const userMember = list.members?.find(m => m.createdBy === userId);
        const isOwnerByMember = userMember?.role === 'owner';
        const isOwner = isOwnerById || isOwnerByMember;
        const isArchivedForUser = list.archivedByUsers?.[userId] === true;
        
        // Only owner can create/update the list itself
        if (isOwner) {
            const listResponse = await fetch(`${SUPABASE_URL}/rest/v1/lists`, {
                method: 'POST',
                headers: {
                    ...this.getAuthHeaders(),
                    'Prefer': 'resolution=merge-duplicates',
                },
                body: JSON.stringify({
                    id: list.id,
                    name: list.name,
                    owner_id: userId,
                    visibility: list.visibility || 'private'
                }),
            });
            
            if (!listResponse.ok) {
                const error = await listResponse.json();
                throw new Error(error.message || 'Failed to sync list');
            }
        }
        
        // Sync user's access to the list (list_users)
        const listUserResponse = await fetch(`${SUPABASE_URL}/rest/v1/list_users`, {
            method: 'POST',
            headers: {
                ...this.getAuthHeaders(),
                'Prefer': 'resolution=merge-duplicates',
            },
            body: JSON.stringify({
                list_id: list.id,
                user_id: userId,
                role: isOwner ? 'owner' : 'editor',
                archived: isArchivedForUser
            }),
        });
        
        if (!listUserResponse.ok) {
            SupabaseLog.logError('Save list_users', await listUserResponse.text());
        }
        
        // Sync members for this list
        for (const member of (list.members || [])) {
            // Only sync members owned by this user
            if (member.createdBy === userId) {
                await this.syncMemberToSupabase(list.id, member);
            }
        }
        
        // Sync items
        for (const item of (list.items || [])) {
            await this.syncItemToSupabase(list.id, item, list.members);
        }
    }
    
    
    async syncItemToSupabase(listId, item, listMembers) {
        const userId = authManager?.getUserId();
        
        // Upsert the item
        const itemResponse = await fetch(`${SUPABASE_URL}/rest/v1/items`, {
            method: 'POST',
            headers: {
                ...this.getAuthHeaders(),
                'Prefer': 'resolution=merge-duplicates',
            },
            body: JSON.stringify({
                id: item.id,
                list_id: listId,
                text: item.text,
                comment: item.comment || '',
                archived: item.archived || false
            }),
        });
        
        if (!itemResponse.ok) {
            SupabaseLog.logError('Save item', await itemResponse.text());
            return;
        }
        
        // Sync item_member_state for each member owned by this user
        // Wrapped in try-catch to fail gracefully if table doesn't exist
        try {
            for (const [memberId, quantity] of Object.entries(item.quantity || {})) {
                const member = listMembers?.find(m => m.id === memberId);
                
                // Only sync state for members owned by this user
                if (member && member.createdBy === userId) {
                    const done = item.done?.[memberId] || false;
                    
                    const response = await fetch(`${SUPABASE_URL}/rest/v1/item_member_state`, {
                        method: 'POST',
                        headers: {
                            ...this.getAuthHeaders(),
                            'Prefer': 'resolution=merge-duplicates',
                        },
                        body: JSON.stringify({
                            item_id: item.id,
                            member_id: memberId,
                            quantity: quantity,
                            done: done
                        }),
                    });
                    
                    // If 404, table doesn't exist - skip silently
                    if (response.status === 404) {
                        break;
                    }
                }
            }
        } catch (err) {
            SupabaseLog.logError('Save item_member_state', err.message);
        }
    }
    
    async deleteListFromSupabase(listId) {
        if (!authManager?.isAuthenticated()) return;
        
        try {
            // Get all items for this list
            const itemsResponse = await this.authenticatedFetch(
                `${SUPABASE_URL}/rest/v1/items?list_id=eq.${listId}&select=id`
            );
            const items = itemsResponse.ok ? await itemsResponse.json() : [];
            
            // Delete item_member_state for all items
            if (items.length > 0) {
                const itemIds = items.map(i => i.id).join(',');
                await this.authenticatedFetch(
                    `${SUPABASE_URL}/rest/v1/item_member_state?item_id=in.(${itemIds})`,
                    { method: 'DELETE' }
                );
            }
            
            // Delete items
            await this.authenticatedFetch(
                `${SUPABASE_URL}/rest/v1/items?list_id=eq.${listId}`,
                { method: 'DELETE' }
            );
            
            // Delete members for this list
            await this.authenticatedFetch(
                `${SUPABASE_URL}/rest/v1/members?list_id=eq.${listId}`,
                { method: 'DELETE' }
            );
            
            // Delete all list_users entries
            await this.authenticatedFetch(
                `${SUPABASE_URL}/rest/v1/list_users?list_id=eq.${listId}`,
                { method: 'DELETE' }
            );
            
            // Delete the list itself
            const listResponse = await this.authenticatedFetch(
                `${SUPABASE_URL}/rest/v1/lists?id=eq.${listId}`,
                { method: 'DELETE' }
            );
            if (!listResponse.ok) {
                SupabaseLog.logError('Delete list', await listResponse.text());
            }
        } catch (err) {
            SupabaseLog.logError('Delete list', err.message);
            if (err.message.includes('Session expired')) {
                alert('Your session has expired. Please sign in again.');
            }
        }
    }
    
    async removeListAccessFromSupabase(listId) {
        if (!authManager?.isAuthenticated()) return;
        
        const userId = authManager.getUserId();
        
        try {
            const response = await fetch(
                `${SUPABASE_URL}/rest/v1/list_users?list_id=eq.${listId}&user_id=eq.${userId}`,
                { method: 'DELETE', headers: this.getAuthHeaders() }
            );
            
            if (!response.ok) {
                SupabaseLog.logError('Remove list access', await response.text());
            }
        } catch (err) {
            SupabaseLog.logError('Remove list access', err.message);
        }
    }
    
    async updateListArchivedStatus(listId, archived) {
        if (!authManager?.isAuthenticated()) return;
        
        const userId = authManager.getUserId();
        const list = this.lists.find(l => l.id === listId);
        const isOwner = list ? this.isUserOwnerOfList(list) : false;
        
        try {
            const response = await fetch(
                `${SUPABASE_URL}/rest/v1/list_users`,
                {
                    method: 'POST',
                    headers: {
                        ...this.getAuthHeaders(),
                        'Prefer': 'resolution=merge-duplicates',
                    },
                    body: JSON.stringify({
                        list_id: listId,
                        user_id: userId,
                        role: isOwner ? 'owner' : 'editor',
                        archived: archived
                    }),
                }
            );
            
            if (!response.ok) {
                SupabaseLog.logError('Update archived status', await response.text());
            }
        } catch (err) {
            SupabaseLog.logError('Update archived status', err.message);
        }
    }
    
    async deleteItemFromSupabase(itemId) {
        if (!authManager?.isAuthenticated()) return;
        
        try {
            await fetch(
                `${SUPABASE_URL}/rest/v1/item_member_state?item_id=eq.${itemId}`,
                { method: 'DELETE', headers: this.getAuthHeaders() }
            );
            
            const response = await fetch(
                `${SUPABASE_URL}/rest/v1/items?id=eq.${itemId}`,
                { method: 'DELETE', headers: this.getAuthHeaders() }
            );
            
            if (!response.ok) {
                SupabaseLog.logError('Delete item', await response.text());
            }
        } catch (err) {
            SupabaseLog.logError('Delete item', err.message);
        }
    }
    
    async deleteMemberFromSupabase(listId, memberId) {
        if (!authManager?.isAuthenticated()) return;
        
        try {
            // Delete item_member_state entries for this member in this list
            const itemsResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/items?list_id=eq.${listId}&select=id`,
                { headers: this.getAuthHeaders() }
            );
            const items = itemsResponse.ok ? await itemsResponse.json() : [];
            
            if (items.length > 0) {
                const itemIds = items.map(i => i.id).join(',');
                await fetch(
                    `${SUPABASE_URL}/rest/v1/item_member_state?item_id=in.(${itemIds})&member_id=eq.${memberId}`,
                    { method: 'DELETE', headers: this.getAuthHeaders() }
                );
            }
            
            // Delete the member
            const response = await fetch(
                `${SUPABASE_URL}/rest/v1/members?id=eq.${memberId}&list_id=eq.${listId}`,
                { method: 'DELETE', headers: this.getAuthHeaders() }
            );
            
            if (!response.ok) {
                SupabaseLog.logError('Delete member', await response.text());
            }
        } catch (err) {
            SupabaseLog.logError('Delete member', err.message);
        }
    }
    
    async backgroundSyncOnSignIn() {
        if (!authManager?.isAuthenticated()) return;
        
        // Snapshot local state before fetching remote
        const localLists = this.lists.map(list => ({
            id: list.id,
            name: list.name,
            isOwner: this.isUserOwnerOfList(list),
            itemCount: (list.items || []).length,
            memberCount: (list.members || []).length,
            isArchived: this.isListArchivedForUser(list),
            shareToken: list.shareToken
        }));
        
        // Fetch remote data
        try {
            await this.loadFromSupabase();
        } catch (err) {
            SupabaseLog.logError('Fetch lists (background sync)', err.message);
            return;
        }
        
        // Snapshot remote state after fetching
        const remoteLists = this.lists.map(list => ({
            id: list.id,
            name: list.name,
            isOwner: this.isUserOwnerOfList(list),
            itemCount: (list.items || []).length,
            memberCount: (list.members || []).length,
            isArchived: this.isListArchivedForUser(list),
            shareToken: list.shareToken
        }));
        
        // Compare and report changes
        const changes = [];
        const localIds = new Set(localLists.map(l => l.id));
        const remoteIds = new Set(remoteLists.map(l => l.id));
        
        // Check for deleted/removed lists
        for (const local of localLists) {
            if (!remoteIds.has(local.id)) {
                if (local.isOwner) {
                    changes.push(`List "${local.name}" was deleted`);
                } else {
                    changes.push(`Access to "${local.name}" was revoked or list was deleted`);
                }
            }
        }
        
        // Check for new lists on server that don't exist locally
        const newOwnedLists = [];
        const newSharedLists = [];
        for (const remote of remoteLists) {
            if (!localIds.has(remote.id)) {
                if (remote.isOwner) {
                    newOwnedLists.push(remote.name);
                } else {
                    newSharedLists.push(remote.name);
                }
                changes.push(`New list "${remote.name}" available`);
            }
        }
        
        // Show notification if there are new owned lists from server
        if (newOwnedLists.length > 0) {
            const listNames = newOwnedLists.join(', ');
            setTimeout(() => {
                alert(`Your lists from server: ${listNames}\n\nThese lists were synced from the server.`);
            }, 500);
        }
        
        // Check for changes in existing lists
        for (const local of localLists) {
            const remote = remoteLists.find(r => r.id === local.id);
            if (!remote) continue;
            
            // Shared list went private (had share token, now doesn't)
            if (!local.isOwner && local.shareToken && !remote.shareToken) {
                changes.push(`"${local.name}" is no longer shared`);
            }
            
            // Item count changed
            if (local.itemCount !== remote.itemCount) {
                const diff = remote.itemCount - local.itemCount;
                const diffText = diff > 0 ? `+${diff}` : `${diff}`;
                changes.push(`"${local.name}": ${diffText} items (${local.itemCount} → ${remote.itemCount})`);
            }
            
            // Member count changed
            if (local.memberCount !== remote.memberCount) {
                const diff = remote.memberCount - local.memberCount;
                const diffText = diff > 0 ? `+${diff}` : `${diff}`;
                changes.push(`"${local.name}": ${diffText} members (${local.memberCount} → ${remote.memberCount})`);
            }
            
            // Archive status changed
            if (local.isArchived !== remote.isArchived) {
                changes.push(`"${local.name}" ${remote.isArchived ? 'was archived' : 'was restored'}`);
            }
        }
        
        // Re-render to show updated data if changes detected and no menu is open
        if (changes.length > 0 && !document.querySelector('.list-menu-dropdown.open')) {
            this.renderLists();
        }
    }
    
    async loadFromSupabase() {
        if (!authManager?.isAuthenticated()) {
            return null;
        }
        
        const userId = authManager.getUserId();
        this.syncStatus = 'syncing';
        
        try {
            // 1. Load and merge profile from Supabase
            const remoteProfile = await this.loadProfileFromSupabase();
            const localProfile = authManager.getUserProfile(userId) || {};
            
            if (remoteProfile) {
                // Remote profile exists - prefer remote values over local
                const mergedProfile = {
                    userName: remoteProfile.userName || localProfile.userName,
                    nickName: remoteProfile.nickName || localProfile.nickName
                };
                authManager.setUserProfile(userId, mergedProfile);
            } else if (!localProfile.nickName) {
                // No remote profile and no local nickName - set default
                const defaultName = authManager.user?.email?.split('@')[0] || 'User';
                authManager.setUserProfile(userId, {
                    userName: localProfile.userName || '',
                    nickName: defaultName
                });
            }
            
            // 2. Get lists where user has access (list_users)
            const listUsersResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/list_users?user_id=eq.${userId}&select=list_id,user_id,role,archived`,
                { headers: this.getAuthHeaders() }
            );
            
            if (!listUsersResponse.ok) {
                throw new Error('Failed to fetch list access');
            }
            
            const listUsers = await listUsersResponse.json();
            
            if (!listUsers || listUsers.length === 0) {
                // No lists on server - remove shared lists from local (keep only owned)
                const userId = authManager.getUserId();
                const ownedListsOnly = this.lists.filter(list => {
                    const isOwner = list.ownerId === userId || 
                        list.members?.some(m => m.createdBy === userId && m.role === 'owner');
                    return isOwner;
                });
                
                this.lists = ownedListsOnly;
                this.saveStateToLocalStorageOnly();
                authManager.updateUI();
                this.renderLists();
                this.syncStatus = 'synced';
                return [];
            }
            
            const listIds = listUsers.map(lu => lu.list_id);
            
            // 3. Get list details
            const listsResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/lists?id=in.(${listIds.join(',')})&select=*`,
                { headers: this.getAuthHeaders() }
            );
            
            if (!listsResponse.ok) {
                throw new Error('Failed to fetch lists');
            }
            
            const lists = await listsResponse.json();
            
            // 4. Get all members for these lists (directly from members table)
            const membersResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/members?list_id=in.(${listIds.join(',')})&select=*`,
                { headers: this.getAuthHeaders() }
            );
            
            const membersData = membersResponse.ok ? await membersResponse.json() : [];
            
            // 6. Get items for all lists
            const itemsResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/items?list_id=in.(${listIds.join(',')})&select=*`,
                { headers: this.getAuthHeaders() }
            );
            
            const items = itemsResponse.ok ? await itemsResponse.json() : [];
            
            // 7. Get item_member_state
            const itemIds = items.map(i => i.id);
            let itemMemberStates = [];
            
            if (itemIds.length > 0) {
                const statesResponse = await fetch(
                    `${SUPABASE_URL}/rest/v1/item_member_state?item_id=in.(${itemIds.join(',')})&select=*`,
                    { headers: this.getAuthHeaders() }
                );
                
                if (statesResponse.ok) {
                    itemMemberStates = await statesResponse.json();
                }
            }
            
            // 8. Get profiles for all users who own members in these lists + list owners
            const memberOwnerIds = [...new Set(membersData.map(m => m.user_id))];
            const listOwnerIds = [...new Set(lists.map(l => l.owner_id))];
            const allUserIds = [...new Set([...memberOwnerIds, ...listOwnerIds])];
            let profilesData = [];
            
            if (allUserIds.length > 0) {
                const profilesResponse = await fetch(
                    `${SUPABASE_URL}/rest/v1/profiles?id=in.(${allUserIds.join(',')})&select=*`,
                    { headers: this.getAuthHeaders() }
                );
                
                if (profilesResponse.ok) {
                    profilesData = await profilesResponse.json();
                }
            }
            
            // 9. Get share tokens for lists owned by this user
            let shareTokensData = [];
            const ownedListIds = lists.filter(l => l.owner_id === userId).map(l => l.id);
            if (ownedListIds.length > 0) {
                const sharesResponse = await fetch(
                    `${SUPABASE_URL}/rest/v1/list_shares?list_id=in.(${ownedListIds.join(',')})&select=list_id,token`,
                    { headers: this.getAuthHeaders() }
                );
                if (sharesResponse.ok) {
                    shareTokensData = await sharesResponse.json();
                }
            }
            
            // Create lookup maps
            const profileById = new Map(profilesData.map(p => [p.id, p]));
            const listUserByListId = new Map(listUsers.map(lu => [lu.list_id, lu]));
            const shareTokenByListId = new Map(shareTokensData.map(s => [s.list_id, s.token]));
            
            // Transform to local format
            const transformedLists = lists.map(list => {
                const listUserData = listUserByListId.get(list.id);
                const listMembersForList = membersData.filter(m => m.list_id === list.id);
                const listItems = items.filter(i => i.list_id === list.id);
                
                // Build per-user archived status
                const archivedByUsers = {};
                listUsers.filter(lu => lu.list_id === list.id).forEach(lu => {
                    const isArchived = lu.archived === true || lu.archived === 'true';
                    if (isArchived) {
                        archivedByUsers[lu.user_id] = true;
                    }
                });
                
                // Build members array for this list
                const members = listMembersForList.map(memberData => {
                    const ownerProfile = profileById.get(memberData.user_id);
                    
                    // Determine role based on whether member's owner is the list owner
                    const memberOwnerIsListOwner = memberData.user_id === list.owner_id;
                    
                    return {
                        id: memberData.id,
                        name: memberData.name || 'Unknown',
                        role: memberOwnerIsListOwner ? 'owner' : 'editor',
                        createdBy: memberData.user_id,
                        creatorUserName: ownerProfile?.user_name,
                        creatorNickName: ownerProfile?.nick_name,
                        creatorEmail: ownerProfile?.email
                    };
                });
                
                // Build items with quantities
                const transformedItems = listItems.map(item => {
                    const quantities = {};
                    const done = {};
                    
                    itemMemberStates
                        .filter(s => s.item_id === item.id)
                        .forEach(s => {
                            quantities[s.member_id] = s.quantity;
                            done[s.member_id] = s.done;
                        });
                    
                    return {
                        id: item.id,
                        text: item.text,
                        comment: item.comment || '',
                        archived: item.archived || false,
                        quantity: quantities,
                        done: done
                    };
                });
                
                // Get owner info from profiles
                const ownerProfile = profileById.get(list.owner_id);
                
                return {
                    id: list.id,
                    name: list.name,
                    createdAt: list.created_at,
                    updatedAt: list.updated_at,
                    visibility: list.visibility || 'private',
                    ownerId: list.owner_id,
                    ownerNickName: ownerProfile?.nick_name,
                    ownerUserName: ownerProfile?.user_name,
                    archivedByUsers,
                    shareToken: shareTokenByListId.get(list.id) || null,
                    members,
                    items: transformedItems
                };
            });
            
            // Merge remote lists with local lists
            const remoteListsById = new Map(transformedLists.map(l => [l.id, l]));
            
            // Merge: prefer remote data, but keep local-only lists
            const mergedLists = [];
            const processedIds = new Set();
            
            // First, process remote lists (they take priority)
            for (const remoteList of transformedLists) {
                mergedLists.push(remoteList);
                processedIds.add(remoteList.id);
            }
            
            // Then, add any local-only lists (not yet synced to Supabase)
            // BUT: only keep owned lists - shared lists that don't exist remotely were deleted/revoked
            for (const localList of this.lists) {
                if (!processedIds.has(localList.id)) {
                    // Only keep if user is the owner (local-only list not yet synced)
                    // Don't keep shared lists - if they're not in Supabase, access was revoked
                    const isOwner = localList.ownerId === userId || 
                        localList.members?.some(m => m.createdBy === userId && m.role === 'owner');
                    if (isOwner) {
                        mergedLists.push(localList);
                    }
                }
            }
            
            // Update local state - save to localStorage WITHOUT triggering sync back to Supabase
            this.lists = mergedLists;
            this.saveStateToLocalStorageOnly();
            
            // Only re-render if no menu is open (to avoid interrupting user interaction)
            if (!document.querySelector('.list-menu-dropdown.open')) {
                this.renderLists();
            }
            
            // Update auth UI in case profile changed
            authManager.updateUI();
            
            this.syncStatus = 'synced';
            return transformedLists;
            
        } catch (err) {
            SupabaseLog.logError('Fetch lists', err.message);
            this.syncStatus = 'error';
            return null;
        }
    }
    
    handleStorageError() {
        this.storageHealthy = false;
        
        const exportNow = confirm(
            'Storage limit reached! Your changes cannot be saved.\n\n' +
            'Click OK to export all lists now (recommended), or Cancel to continue without saving.\n\n' +
            'To free up space, export your data and then archive or delete old lists.'
        );
        
        if (exportNow) {
            this.exportAllLists();
        }
        
        this.showStorageWarning();
    }
    
    showStorageWarning() {
        // Add visual indicator that storage is unhealthy
        document.body.classList.add('storage-error');
    }
    
    clearStorageWarning() {
        document.body.classList.remove('storage-error');
        this.storageHealthy = true;
    }
    
    exportAllLists() {
        const exportData = {
            exportVersion: 1,
            exportedAt: new Date().toISOString(),
            lists: this.lists
        };
        
        const json = JSON.stringify(exportData, null, 2);
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `all-lists-backup_${dateStr}.json`;
        this.downloadJsonFile(json, filename);
    }
    
    canMutate() {
        if (!authManager?.isAuthenticated()) {
            return false;
        }
        if (!this.storageHealthy) {
            alert('Storage is full. Please export your data and free up space before making changes.');
            return false;
        }
        return true;
    }
    
    saveLists() {
        this.saveState();
    }
    
    createList() {
        if (!this.canMutate()) return;
        
        // Check authentication before creating
        if (!authManager?.isAuthenticated()) {
            alert('Please sign in to create lists.');
            return;
        }
        
        this.hideListAutocomplete();
        
        const name = this.newListInput.value.trim();
        if (!name) return;
        
        // Check for existing list with same name
        const conflict = this.lists.find(l => l.name.toLowerCase() === name.toLowerCase());
        if (conflict) {
            const suggestedName = this.getUniqueCopyName(name);
            const isArchived = conflict.archived;
            const archiveNote = isArchived ? ' (archived)' : '';
            
            const useSuggested = confirm(
                `A list named "${conflict.name}"${archiveNote} already exists.\n\n` +
                `Click OK to create as "${suggestedName}" instead.`
            );
            
            if (useSuggested) {
                this.newListInput.value = suggestedName;
                this.doCreateList(suggestedName);
            }
            return;
        }
        
        this.doCreateList(name);
    }
    
    async doCreateList(name) {
        const now = new Date().toISOString();
        const userId = authManager?.getUserId();
        const profile = userId ? authManager.getUserProfile(userId) : null;
        const memberName = profile?.nickName || authManager?.user?.email?.split('@')[0] || 'me';
        const member = {
            id: generateUUID(),
            name: memberName,
            role: 'owner',
            createdBy: userId,
            creatorUserName: profile?.userName,
            creatorNickName: profile?.nickName,
            creatorEmail: authManager?.user?.email
        };
        const newList = {
            id: generateUUID(),
            name: name,
            ownerId: userId,
            visibility: 'private',
            createdAt: now,
            updatedAt: now,
            members: [member],
            items: []
        };
        
        this.lists.push(newList);
        this.saveLists();
        this.newListInput.value = '';
        this.renderLists();
        
        // Sync new list to Supabase
        if (authManager?.isAuthenticated()) {
            try {
                await this.syncListToSupabase(newList);
            } catch (err) {
                SupabaseLog.logError('Save new list', err.message);
            }
        }
    }
    
    getUniqueCopyName(baseName) {
        let name = `${baseName} (Copy)`;
        
        if (!this.lists.some(l => l.name.toLowerCase() === name.toLowerCase())) {
            return name;
        }
        
        let counter = 2;
        while (this.lists.some(l => l.name.toLowerCase() === name.toLowerCase())) {
            name = `${baseName} (Copy ${counter})`;
            counter++;
        }
        
        return name;
    }
    
    async joinList() {
        if (!this.canMutate()) return;
        
        if (!authManager?.isAuthenticated()) {
            alert('Please sign in to join a list.');
            return;
        }
        
        const input = this.joinListInput.value.trim();
        if (!input) return;
        
        // Parse input as "join/<token>"
        let token = input;
        if (input.toLowerCase().startsWith('join/')) {
            token = input.substring(5).trim();
        }
        
        if (!token) {
            alert('Please enter a valid join token: join/<token>');
            return;
        }
        
        const userId = authManager.getUserId();
        
        try {
            // Look up the token in list_shares, joining with lists only
            const shareResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/list_shares?token=eq.${encodeURIComponent(token)}&select=*,lists(*)`,
                { headers: this.getAuthHeaders() }
            );
            
            if (!shareResponse.ok) {
                throw new Error('Failed to look up token');
            }
            
            const shares = await shareResponse.json();
            
            if (!shares || shares.length === 0) {
                alert('Invalid join token. Please check and try again.');
                return;
            }
            
            const share = shares[0];
            const list = share.lists;
            
            // Fetch owner profile separately if needed
            let ownerProfile = null;
            if (list?.owner_id) {
                const profileResponse = await fetch(
                    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${list.owner_id}&select=nick_name,user_name`,
                    { headers: this.getAuthHeaders() }
                );
                if (profileResponse.ok) {
                    const profiles = await profileResponse.json();
                    ownerProfile = profiles[0] || null;
                }
            }
            
            if (!list) {
                alert('The shared list no longer exists.');
                return;
            }
            
            const displayOwnerName = ownerProfile?.nick_name || ownerProfile?.user_name || 'Unknown';
            
            // Check if user already has access
            const existingList = this.lists.find(l => l.id === list.id);
            if (existingList && !this.isListRemovedForUser(existingList)) {
                alert(`You already have access to "${list.name}".`);
                this.joinListInput.value = '';
                return;
            }
            
            // Create list_users entry for the new user
            const listUserResponse = await fetch(`${SUPABASE_URL}/rest/v1/list_users`, {
                method: 'POST',
                headers: {
                    ...this.getAuthHeaders(),
                    'Prefer': 'resolution=merge-duplicates',
                },
                body: JSON.stringify({
                    list_id: list.id,
                    user_id: userId,
                    role: 'editor',
                    archived: false
                }),
            });
            
            if (!listUserResponse.ok) {
                throw new Error('Failed to join list');
            }
            
            // Reload lists from Supabase to get the new list
            await this.loadFromSupabase();
            
            this.joinListInput.value = '';
            
        } catch (err) {
            SupabaseLog.logError('Join list', err.message);
            alert('Failed to join list. Please try again.');
        }
    }
    
    async archiveList(listId) {
        if (!this.canMutate()) return;
        
        const list = this.lists.find(l => l.id === listId);
        if (!list) return;
        
        const userId = authManager?.getUserId();
        if (!userId) return;
        
        // Per-user archiving
        if (!list.archivedByUsers) list.archivedByUsers = {};
        list.archivedByUsers[userId] = true;
        
        // Sync archived status to Supabase immediately
        if (this.syncEnabled && authManager?.isAuthenticated()) {
            await this.updateListArchivedStatus(listId, true);
        }
        
        this.saveLists();
        this.renderLists();
    }
    
    async restoreList(listId) {
        if (!this.canMutate()) return;
        
        const list = this.lists.find(l => l.id === listId);
        if (!list) return;
        
        const userId = authManager?.getUserId();
        if (!userId) return;
        
        // Per-user restore
        if (!list.archivedByUsers) list.archivedByUsers = {};
        list.archivedByUsers[userId] = false;
        
        // Sync archived status to Supabase immediately
        if (this.syncEnabled && authManager?.isAuthenticated()) {
            await this.updateListArchivedStatus(listId, false);
        }
        
        this.saveLists();
        this.renderLists();
    }
    
    isListArchivedForUser(list) {
        const userId = authManager?.getUserId();
        if (!userId) return false;
        return list.archivedByUsers?.[userId] === true;
    }
    
    isUserOwnerOfList(list) {
        const userId = authManager?.getUserId();
        if (!userId) return false;
        // Check ownerId from Supabase or fall back to checking member roles
        if (list.ownerId) {
            return list.ownerId === userId;
        }
        // Fallback: check if any member created by this user has owner role
        return list.members?.some(m => m.createdBy === userId && m.role === 'owner') || false;
    }
    
    async shareList(listId) {
        if (!authManager?.isAuthenticated()) {
            alert('Please sign in to share lists.');
            return;
        }
        
        const list = this.lists.find(l => l.id === listId);
        if (!list) return;
        
        if (!this.isUserOwnerOfList(list)) {
            alert('Only the list owner can share this list.');
            return;
        }
        
        this.showShareModal(list);
    }
    
    async showShareModal(list) {
        const modal = document.getElementById('shareModal');
        const listNameEl = document.getElementById('shareModalListName');
        const tokenSection = document.getElementById('shareTokenSection');
        const tokenInput = document.getElementById('shareTokenInput');
        const privateRadio = document.querySelector('input[name="shareVisibility"][value="private"]');
        const linkRadio = document.querySelector('input[name="shareVisibility"][value="link"]');
        const copyBtn = document.getElementById('copyTokenBtn');
        const closeBtn = document.getElementById('shareModalClose');
        const backdrop = modal.querySelector('.modal-backdrop');
        
        listNameEl.textContent = `"${list.name}"`;
        this.currentShareListId = list.id;
        
        // Use cached shareToken from list
        const existingToken = list.shareToken;
        
        // Set initial state
        if (existingToken) {
            linkRadio.checked = true;
            tokenSection.style.display = '';
            tokenInput.value = existingToken;
        } else {
            privateRadio.checked = true;
            tokenSection.style.display = 'none';
            tokenInput.value = '';
        }
        
        // Handle visibility change
        const handleVisibilityChange = async (e) => {
            const value = e.target.value;
            if (value === 'link') {
                tokenSection.style.display = '';
                if (!tokenInput.value) {
                    await this.generateShareToken(list.id, tokenInput);
                }
            } else {
                tokenSection.style.display = 'none';
                if (tokenInput.value) {
                    await this.deleteShareToken(list.id);
                    tokenInput.value = '';
                }
            }
            this.renderLists();
        };
        
        privateRadio.addEventListener('change', handleVisibilityChange);
        linkRadio.addEventListener('change', handleVisibilityChange);
        
        // Copy button
        const handleCopy = () => {
            tokenInput.select();
            navigator.clipboard.writeText(tokenInput.value);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        };
        copyBtn.addEventListener('click', handleCopy);
        
        // Close handlers
        const closeModal = () => {
            modal.style.display = 'none';
            privateRadio.removeEventListener('change', handleVisibilityChange);
            linkRadio.removeEventListener('change', handleVisibilityChange);
            copyBtn.removeEventListener('click', handleCopy);
        };
        
        closeBtn.addEventListener('click', closeModal, { once: true });
        backdrop.addEventListener('click', closeModal, { once: true });
        
        modal.style.display = '';
    }
    
    async generateShareToken(listId, tokenInput) {
        const userId = authManager.getUserId();
        
        try {
            // First, ensure the list exists in Supabase
            const list = this.lists.find(l => l.id === listId);
            if (!list) {
                alert('List not found.');
                return;
            }
            
            // Check if list exists in Supabase
            const listCheckResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/lists?id=eq.${listId}&select=id`,
                { headers: this.getAuthHeaders() }
            );
            const listCheckData = await listCheckResponse.json();
            
            if (listCheckData.length === 0) {
                // List doesn't exist in Supabase, sync it first
                await this.syncListToSupabase(list);
            }
            
            // Check if a token already exists for this list
            const existingResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/list_shares?list_id=eq.${listId}&select=token`,
                { headers: this.getAuthHeaders() }
            );
            
            const existingData = await existingResponse.json();
            
            if (existingResponse.ok && existingData.length > 0) {
                // Token already exists, use it
                const existingToken = existingData[0].token;
                tokenInput.value = existingToken;
                list.shareToken = existingToken;
                return;
            }
            
            // Generate a new token
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let token = '';
            for (let i = 0; i < 8; i++) {
                token += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            
            const response = await fetch(`${SUPABASE_URL}/rest/v1/list_shares`, {
                method: 'POST',
                headers: {
                    ...this.getAuthHeaders(),
                    'Prefer': 'return=representation',
                },
                body: JSON.stringify({
                    list_id: listId,
                    token: token,
                    created_by: userId
                }),
            });
            
            if (response.ok) {
                tokenInput.value = token;
                if (list) list.shareToken = token;
            } else {
                const responseBody = await response.text();
                throw new Error(`Failed to create token: ${responseBody}`);
            }
        } catch (err) {
            SupabaseLog.logError('Generate share token', err.message);
            alert('Failed to generate share code. Please try again.');
        }
    }
    
    async deleteShareToken(listId) {
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/list_shares?list_id=eq.${listId}`, {
                method: 'DELETE',
                headers: this.getAuthHeaders(),
            });
            // Update the local list's shareToken
            const list = this.lists.find(l => l.id === listId);
            if (list) list.shareToken = null;
        } catch (err) {
            SupabaseLog.logError('Delete share token', err.message);
        }
    }
    
    duplicateList(listId) {
        if (!this.canMutate()) return;
        
        const list = this.lists.find(l => l.id === listId);
        if (!list) return;
        
        const now = new Date().toISOString();
        
        // Generate new UUIDs for the duplicate
        const memberIdMap = {};
        const newMembers = (list.members || []).map(m => {
            const newId = generateUUID();
            memberIdMap[m.id] = newId;
            return { ...m, id: newId };
        });
        
        const newItems = (list.items || []).map(item => {
            const newQuantity = {};
            const newDone = {};
            
            if (item.quantity) {
                Object.keys(item.quantity).forEach(oldId => {
                    const newId = memberIdMap[oldId];
                    if (newId) newQuantity[newId] = item.quantity[oldId];
                });
            }
            if (item.done) {
                Object.keys(item.done).forEach(oldId => {
                    const newId = memberIdMap[oldId];
                    if (newId) newDone[newId] = item.done[oldId];
                });
            }
            
            return {
                ...item,
                id: generateUUID(),
                quantity: newQuantity,
                done: newDone
            };
        });
        
        // Generate unique name
        let baseName = `${list.name} (Copy)`;
        let newName = baseName;
        let counter = 2;
        while (this.lists.some(l => l.name.toLowerCase() === newName.toLowerCase())) {
            newName = `${list.name} (Copy ${counter})`;
            counter++;
        }
        
        const duplicatedList = {
            id: generateUUID(),
            name: newName,
            createdAt: now,
            updatedAt: now,
            members: newMembers,
            items: newItems
        };
        
        this.lists.push(duplicatedList);
        this.saveLists();
        this.renderLists();
    }
    
    async permanentlyDeleteList(listId) {
        const list = this.lists.find(l => l.id === listId);
        if (!list) return;
        
        const isOwner = this.isUserOwnerOfList(list);
        const userId = authManager?.getUserId();
        
        if (isOwner) {
            // Owner deletes: permanently delete for everyone
            if (!confirm(`Permanently delete "${list.name}" and all its items for everyone? This cannot be undone.`)) return;
            
            this.lists = this.lists.filter(l => l.id !== listId);
            
            // Delete from Supabase
            if (this.syncEnabled && authManager?.isAuthenticated()) {
                await this.deleteListFromSupabase(listId);
            }
        } else {
            // Non-owner deletes: just remove from their view
            if (!confirm(`Remove "${list.name}" from your lists? Other users will still see it.`)) return;
            
            if (!list.removedByUsers) list.removedByUsers = {};
            list.removedByUsers[userId] = true;
            
            // Remove access from Supabase
            if (this.syncEnabled && authManager?.isAuthenticated()) {
                await this.removeListAccessFromSupabase(listId);
            }
        }
        
        // Try to save - this might recover from storage error
        this.retryStorage();
        this.saveLists();
        this.renderLists();
    }
    
    isListRemovedForUser(list) {
        const userId = authManager?.getUserId();
        if (!userId) return false;
        return list.removedByUsers?.[userId] === true;
    }
    
    retryStorage() {
        if (!this.storageHealthy) {
            this.storageHealthy = true;
            this.clearStorageWarning();
        }
    }
    
    async openList(listId) {
        this.currentListId = listId;
        
        // First, show list immediately with local data
        const list = this.lists.find(l => l.id === listId);
        if (!list) return;
        
        this.listTitle.textContent = list.name;
        this.listManagerView.style.display = 'none';
        this.listEditorView.style.display = 'block';
        
        // Update URL without reloading
        this.updateUrl(listId);
        
        // Store initial snapshot and list state for change detection when leaving
        this.initialListSnapshot = this.createListContentSnapshot(list);
        this.initialListState = JSON.parse(JSON.stringify(list)); // Deep copy for pretty printing later
        
        // Initialize the list editor with local data
        this.listEditor = new FamiList(this);
        
        // Then, reload from Supabase in background and merge changes
        if (authManager?.isAuthenticated()) {
            this.showRetrievingOverlay();
            this.refreshListFromSupabase(listId);
        }
    }
    
    showRetrievingOverlay() {
        const overlay = document.getElementById('retrievingDataOverlay');
        const text = document.getElementById('retrievingText');
        const spinner = document.getElementById('retrievingSpinner');
        if (overlay) {
            overlay.style.display = 'flex';
            text.textContent = 'Retrieving data...';
            spinner.textContent = '⏳';
        }
    }
    
    hideRetrievingOverlay() {
        const overlay = document.getElementById('retrievingDataOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
    
    showOfflineMessage() {
        const text = document.getElementById('retrievingText');
        const spinner = document.getElementById('retrievingSpinner');
        if (text && spinner) {
            spinner.textContent = '⚠️';
            text.innerHTML = 'Server unavailable - working offline<br><button onclick="listManager.hideRetrievingOverlay()" style="margin-top: 10px; padding: 8px 16px; cursor: pointer;">Continue Offline</button>';
        }
    }
    
    async refreshListFromSupabase(listId) {
        // Set up 10 second timeout for offline detection
        const timeoutId = setTimeout(() => {
            this.showOfflineMessage();
        }, 10000);
        
        try {
            // Create a simple content snapshot of the current list for comparison
            const localList = this.lists.find(l => l.id === listId);
            if (!localList) {
                clearTimeout(timeoutId);
                this.hideRetrievingOverlay();
                return;
            }
            
            // Snapshot only the visible content
            const localSnapshot = this.createListContentSnapshot(localList);
            
            // Fetch only this specific list from Supabase
            const updatedList = await this.fetchSingleListFromSupabase(listId);
            
            // Clear timeout - we got a response
            clearTimeout(timeoutId);
            this.hideRetrievingOverlay();
            
            if (!updatedList) return;
            
            // Update the list in local state
            const listIndex = this.lists.findIndex(l => l.id === listId);
            if (listIndex >= 0) {
                this.lists[listIndex] = updatedList;
                this.saveStateToLocalStorageOnly();
            }
            
            // Create snapshot of remote content
            const remoteSnapshot = this.createListContentSnapshot(updatedList);
            
            // Simple string comparison of snapshots
            const hasChanges = localSnapshot !== remoteSnapshot;
            
            // Log remote data fetched from server
            SupabaseLog.logRemoteData(localList.name, {
                members: (updatedList.members || []).map(m => m.name),
                items: (updatedList.items || []).map(i => ({
                    text: i.text,
                    archived: i.archived || false,
                    comment: i.comment || '',
                    quantities: Object.entries(i.quantity || {}).map(([mid, qty]) => {
                        const member = (updatedList.members || []).find(m => m.id === mid);
                        return `${member?.name || 'unknown'}:${qty}`;
                    }),
                    done: Object.entries(i.done || {}).map(([mid, d]) => {
                        const member = (updatedList.members || []).find(m => m.id === mid);
                        return `${member?.name || 'unknown'}:${d}`;
                    })
                })),
                hasChanges
            });
            
            // Check for data integrity issues in remote data
            const remoteIssues = this.checkRemoteDataIntegrity(updatedList);
            
            // If there are changes and we're still viewing this list, ask user what to do
            if (this.currentListId === listId && this.listEditor) {
                if (remoteIssues.length > 0) {
                    // Remote data has missing item_member_state entries
                    this.pendingRemoteList = updatedList;
                    this.pendingRemoteSnapshot = remoteSnapshot;
                    this.showDataCorruptionModal(remoteIssues);
                } else if (hasChanges) {
                    // Normal sync conflict
                    this.pendingRemoteList = updatedList;
                    this.pendingRemoteSnapshot = remoteSnapshot;
                    this.showSyncConflictModal();
                } else {
                    // No changes - update the baseline snapshot
                    this.initialListSnapshot = remoteSnapshot;
                    this.initialListState = JSON.parse(JSON.stringify(updatedList));
                }
            }
        } catch (err) {
            clearTimeout(timeoutId);
            SupabaseLog.logError('Fetch list data', err.message);
            this.showOfflineMessage();
        }
    }
    
    async fetchSingleListFromSupabase(listId) {
        if (!authManager?.isAuthenticated()) return null;
        
        const userId = authManager.getUserId();
        
        // 1. Get list details
        const listResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/lists?id=eq.${listId}&select=*`,
            { headers: this.getAuthHeaders() }
        );
        if (!listResponse.ok) {
            SupabaseLog.logError('Fetch list', `HTTP ${listResponse.status}`);
            return null;
        }
        const lists = await listResponse.json();
        if (!lists || lists.length === 0) {
            SupabaseLog.logError('Fetch list', 'List not found in Supabase (not synced yet?)');
            return null;
        }
        const list = lists[0];
        
        // 2. Get members for this list
        const membersResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/members?list_id=eq.${listId}&select=*`,
            { headers: this.getAuthHeaders() }
        );
        const membersData = membersResponse.ok ? await membersResponse.json() : [];
        
        // 3. Get items for this list
        const itemsResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/items?list_id=eq.${listId}&select=*`,
            { headers: this.getAuthHeaders() }
        );
        const items = itemsResponse.ok ? await itemsResponse.json() : [];
        
        // 4. Get item_member_state for all items
        const itemIds = items.map(i => i.id);
        let itemMemberStates = [];
        if (itemIds.length > 0) {
            const statesResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/item_member_state?item_id=in.(${itemIds.join(',')})&select=*`,
                { headers: this.getAuthHeaders() }
            );
            if (statesResponse.ok) {
                itemMemberStates = await statesResponse.json();
            }
        }
        
        // 5. Get profiles for member owners and list owner
        const memberOwnerIds = [...new Set(membersData.map(m => m.user_id))];
        const allUserIds = [...new Set([...memberOwnerIds, list.owner_id])];
        let profilesData = [];
        if (allUserIds.length > 0) {
            const profilesResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/profiles?id=in.(${allUserIds.join(',')})&select=*`,
                { headers: this.getAuthHeaders() }
            );
            if (profilesResponse.ok) {
                profilesData = await profilesResponse.json();
            }
        }
        
        // 6. Get list_users for archived status
        const listUsersResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/list_users?list_id=eq.${listId}&select=*`,
            { headers: this.getAuthHeaders() }
        );
        const listUsers = listUsersResponse.ok ? await listUsersResponse.json() : [];
        
        // 7. Get share token if owner
        let shareToken = null;
        if (list.owner_id === userId) {
            const sharesResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/list_shares?list_id=eq.${listId}&select=token`,
                { headers: this.getAuthHeaders() }
            );
            if (sharesResponse.ok) {
                const shares = await sharesResponse.json();
                if (shares.length > 0) {
                    shareToken = shares[0].token;
                }
            }
        }
        
        // Build lookup maps
        const profileById = new Map(profilesData.map(p => [p.id, p]));
        
        // Build per-user archived status
        const archivedByUsers = {};
        listUsers.forEach(lu => {
            if (lu.archived === true || lu.archived === 'true') {
                archivedByUsers[lu.user_id] = true;
            }
        });
        
        // Build members array
        const members = membersData.map(memberData => {
            const ownerProfile = profileById.get(memberData.user_id);
            const memberOwnerIsListOwner = memberData.user_id === list.owner_id;
            
            return {
                id: memberData.id,
                name: memberData.name || 'Unknown',
                role: memberOwnerIsListOwner ? 'owner' : 'editor',
                createdBy: memberData.user_id,
                creatorUserName: ownerProfile?.user_name,
                creatorNickName: ownerProfile?.nick_name,
                creatorEmail: ownerProfile?.email
            };
        });
        
        // Build items with quantities
        const transformedItems = items.map(item => {
            const quantities = {};
            const done = {};
            
            itemMemberStates
                .filter(s => s.item_id === item.id)
                .forEach(s => {
                    quantities[s.member_id] = s.quantity;
                    done[s.member_id] = s.done;
                });
            
            return {
                id: item.id,
                text: item.text,
                comment: item.comment || '',
                archived: item.archived || false,
                quantity: quantities,
                done: done
            };
        });
        
        // Get owner info
        const ownerProfile = profileById.get(list.owner_id);
        
        return {
            id: list.id,
            name: list.name,
            createdAt: list.created_at,
            updatedAt: list.updated_at,
            visibility: list.visibility || 'private',
            ownerId: list.owner_id,
            ownerNickName: ownerProfile?.nick_name,
            ownerUserName: ownerProfile?.user_name,
            archivedByUsers,
            shareToken,
            members,
            items: transformedItems
        };
    }
    
    prettyPrintSnapshot(list) {
        // Human-readable snapshot for debugging
        const memberNames = {};
        (list.members || []).forEach(m => { memberNames[m.id] = m.name || 'unnamed'; });
        
        let output = `\n=== List: ${list.name} ===\n`;
        
        (list.items || []).forEach(item => {
            output += `\n${item.text || '(no name)'}:\n`;
            
            // Show each member's quantity and done status
            (list.members || []).forEach(member => {
                const qty = item.quantity?.[member.id] ?? 1;
                const done = item.done?.[member.id] ? 'yes' : 'no';
                output += `  ${member.name || 'unnamed'}: quantity=${qty}; done=${done}\n`;
            });
            
            output += `  comment: ${item.comment || '(none)'}\n`;
            output += `  archived: ${item.archived ? 'yes' : 'no'}\n`;
        });
        
        return output;
    }
    
    createListContentSnapshot(list) {
        // Create a simple string snapshot of only the VISIBLE/SEMANTIC content
        const memberIds = (list.members || []).map(m => m.id).sort();
        
        const items = (list.items || [])
            .map(item => {
                // Include done for ALL members, only show those that are true
                const doneTrue = memberIds.filter(mid => item.done?.[mid] === true);
                
                // Include quantity for ALL members (use stored value or empty string if missing)
                const qtyEntries = memberIds
                    .map(mid => {
                        const qty = item.quantity?.[mid];
                        return `${mid}:${qty ?? ''}`;
                    });
                
                return `${item.id}:${item.text || ''}:done=${doneTrue.join(',')}:qty=${qtyEntries.join(',')}:${!!item.archived}:${item.comment || ''}`;
            })
            .sort()
            .join('|');
        
        const members = (list.members || [])
            .map(m => `${m.id}:${m.name || ''}`)
            .sort()
            .join('|');
        
        return `${list.name || ''}::${items}::${members}`;
    }
    
    // Check if remote data has integrity issues (members without item_member_state entries)
    checkRemoteDataIntegrity(list) {
        const issues = [];
        const memberIds = (list.members || []).map(m => m.id);
        const memberNames = {};
        (list.members || []).forEach(m => { memberNames[m.id] = m.name; });
        
        for (const item of (list.items || [])) {
            for (const memberId of memberIds) {
                const hasQuantity = item.quantity?.[memberId] !== undefined;
                const hasDone = item.done?.[memberId] !== undefined;
                
                if (!hasQuantity && !hasDone) {
                    issues.push({
                        itemText: item.text,
                        memberName: memberNames[memberId],
                        memberId
                    });
                }
            }
        }
        
        return issues;
    }
    
    showListManager() {
        // Check for pending changes using snapshot comparison
        if (this.currentListId && this.initialListSnapshot && this.listEditor) {
            // Flush any pending changes from the editor to this.lists
            this.listEditor.saveState();
            
            const currentList = this.lists.find(l => l.id === this.currentListId);
            if (currentList) {
                const currentSnapshot = this.createListContentSnapshot(currentList);
                const hasChanges = currentSnapshot !== this.initialListSnapshot;
                
                if (hasChanges) {
                    this.showUnsavedChangesModal();
                    return;
                }
            }
        }
        
        this.doLeaveList();
    }
    
    showUnsavedChangesModal() {
        if (!this.unsavedChangesModal) return;
        
        this.unsavedChangesModal.style.display = 'flex';
        
        // Remove old listeners by cloning buttons
        const newSaveBtn = this.unsavedSaveBtn.cloneNode(true);
        this.unsavedSaveBtn.parentNode.replaceChild(newSaveBtn, this.unsavedSaveBtn);
        this.unsavedSaveBtn = newSaveBtn;
        
        const newDiscardBtn = this.unsavedDiscardBtn.cloneNode(true);
        this.unsavedDiscardBtn.parentNode.replaceChild(newDiscardBtn, this.unsavedDiscardBtn);
        this.unsavedDiscardBtn = newDiscardBtn;
        
        const newCancelBtn = this.unsavedCancelBtn.cloneNode(true);
        this.unsavedCancelBtn.parentNode.replaceChild(newCancelBtn, this.unsavedCancelBtn);
        this.unsavedCancelBtn = newCancelBtn;
        
        // Reset button states
        this.unsavedSaveBtn.textContent = 'Save';
        this.unsavedSaveBtn.style.backgroundColor = '';
        this.unsavedSaveBtn.disabled = false;
        this.unsavedDiscardBtn.disabled = false;
        this.unsavedCancelBtn.disabled = false;
        const errorMsg = document.getElementById('unsavedErrorMsg');
        if (errorMsg) errorMsg.style.display = 'none';
        
        // Save - show "Saving..." and wait for completion
        this.unsavedSaveBtn.addEventListener('click', async () => {
            const errorMsg = document.getElementById('unsavedErrorMsg');
            const originalText = this.unsavedSaveBtn.textContent;
            const originalBg = this.unsavedSaveBtn.style.backgroundColor;
            
            // Show saving state
            this.unsavedSaveBtn.textContent = 'Saving...';
            this.unsavedSaveBtn.style.backgroundColor = '#6c757d';
            this.unsavedSaveBtn.disabled = true;
            this.unsavedDiscardBtn.disabled = true;
            this.unsavedCancelBtn.disabled = true;
            if (errorMsg) errorMsg.style.display = 'none';
            
            try {
                if (this.listEditor) {
                    await this.listEditor.saveToSupabase();
                }
                // Success - close modal and navigate
                this.hideUnsavedChangesModal();
                this.doLeaveList();
            } catch (err) {
                SupabaseLog.logError('Save changes', err.message);
                // Show error in modal
                if (errorMsg) {
                    errorMsg.textContent = 'Failed to save. Server may be unavailable. Try again or choose another option.';
                    errorMsg.style.display = 'block';
                }
                // Reset button state
                this.unsavedSaveBtn.textContent = originalText;
                this.unsavedSaveBtn.style.backgroundColor = originalBg;
                this.unsavedSaveBtn.disabled = false;
                this.unsavedDiscardBtn.disabled = false;
                this.unsavedCancelBtn.disabled = false;
            }
        });
        
        // Discard - navigate immediately, reload in background
        this.unsavedDiscardBtn.addEventListener('click', () => {
            this.hideUnsavedChangesModal();
            if (this.listEditor) {
                this.listEditor.isDirty = false;
            }
            // Navigate back immediately for responsive UI
            this.doLeaveList();
            // Reload from Supabase in background to discard local changes
            if (authManager?.isAuthenticated()) {
                this.loadFromSupabase().catch(err => {
                    SupabaseLog.logError('Fetch lists (background)', err.message);
                });
            }
        });
        
        // Cancel
        this.unsavedCancelBtn.addEventListener('click', () => {
            this.hideUnsavedChangesModal();
        });
        
        // Close on backdrop click
        this.unsavedChangesModal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
            this.hideUnsavedChangesModal();
        }, { once: true });
    }
    
    hideUnsavedChangesModal() {
        if (this.unsavedChangesModal) {
            this.unsavedChangesModal.style.display = 'none';
        }
    }
    
    showSyncConflictModal() {
        if (!this.syncConflictModal) return;
        
        this.syncConflictModal.style.display = 'flex';
        
        // Remove old listeners by cloning buttons
        const newUpdateBtn = this.syncUpdateBtn.cloneNode(true);
        this.syncUpdateBtn.parentNode.replaceChild(newUpdateBtn, this.syncUpdateBtn);
        this.syncUpdateBtn = newUpdateBtn;
        
        const newKeepBtn = this.syncKeepBtn.cloneNode(true);
        this.syncKeepBtn.parentNode.replaceChild(newKeepBtn, this.syncKeepBtn);
        this.syncKeepBtn = newKeepBtn;
        
        // Load Server Data - update local to match remote
        this.syncUpdateBtn.addEventListener('click', () => {
            this.hideSyncConflictModal();
            if (this.pendingRemoteList && this.currentListId) {
                // Update the list in this.lists with remote data
                const listIndex = this.lists.findIndex(l => l.id === this.currentListId);
                if (listIndex !== -1) {
                    this.lists[listIndex] = this.pendingRemoteList;
                    this.saveStateToLocalStorageOnly();
                }
                // Update snapshots
                this.initialListSnapshot = this.pendingRemoteSnapshot;
                this.initialListState = JSON.parse(JSON.stringify(this.pendingRemoteList));
                // Refresh the editor
                this.listTitle.textContent = this.pendingRemoteList.name;
                this.listEditor = new FamiList(this);
            }
            this.pendingRemoteList = null;
            this.pendingRemoteSnapshot = null;
        });
        
        // Keep Local Data - ignore remote changes
        this.syncKeepBtn.addEventListener('click', () => {
            this.hideSyncConflictModal();
            // Keep local data but update baseline so we don't keep asking
            // User will need to save manually to push their changes
            this.pendingRemoteList = null;
            this.pendingRemoteSnapshot = null;
        });
        
        // Close on backdrop click - same as Keep Local
        this.syncConflictModal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
            this.hideSyncConflictModal();
            this.pendingRemoteList = null;
            this.pendingRemoteSnapshot = null;
        }, { once: true });
    }
    
    hideSyncConflictModal() {
        if (this.syncConflictModal) {
            this.syncConflictModal.style.display = 'none';
        }
    }
    
    showDataCorruptionModal(issues) {
        if (!this.dataCorruptionModal) return;
        
        // Group issues by member
        const byMember = {};
        issues.forEach(issue => {
            if (!byMember[issue.memberName]) {
                byMember[issue.memberName] = [];
            }
            byMember[issue.memberName].push(issue.itemText);
        });
        
        // Build details HTML
        let detailsHtml = '<strong>Missing data for:</strong><ul style="margin: 5px 0; padding-left: 20px;">';
        for (const [memberName, items] of Object.entries(byMember)) {
            detailsHtml += `<li><strong>${memberName}</strong>: ${items.length} item(s) missing quantity/done status</li>`;
        }
        detailsHtml += '</ul>';
        
        this.corruptionDetails.innerHTML = detailsHtml;
        this.dataCorruptionModal.style.display = 'flex';
        
        // Remove old listeners by cloning buttons
        const newFixBtn = this.corruptionFixBtn.cloneNode(true);
        this.corruptionFixBtn.parentNode.replaceChild(newFixBtn, this.corruptionFixBtn);
        this.corruptionFixBtn = newFixBtn;
        
        const newIgnoreBtn = this.corruptionIgnoreBtn.cloneNode(true);
        this.corruptionIgnoreBtn.parentNode.replaceChild(newIgnoreBtn, this.corruptionIgnoreBtn);
        this.corruptionIgnoreBtn = newIgnoreBtn;
        
        // Fix by saving local data
        this.corruptionFixBtn.addEventListener('click', async () => {
            this.hideDataCorruptionModal();
            // Save local data to Supabase to fill in missing entries
            if (this.listEditor) {
                await this.listEditor.saveToSupabase();
            }
        });
        
        // Ignore - just keep local data
        this.corruptionIgnoreBtn.addEventListener('click', () => {
            this.hideDataCorruptionModal();
            // Keep local data, user will need to save manually later
        });
        
        // Close on backdrop click
        this.dataCorruptionModal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
            this.hideDataCorruptionModal();
        }, { once: true });
    }
    
    hideDataCorruptionModal() {
        if (this.dataCorruptionModal) {
            this.dataCorruptionModal.style.display = 'none';
        }
    }
    
    doLeaveList() {
        this.listEditorView.style.display = 'none';
        this.listManagerView.style.display = 'block';
        this.currentListId = null;
        this.listEditor = null;
        this.initialListSnapshot = null;
        this.initialListState = null;
        
        // Clear URL parameter without reloading
        this.updateUrl(null);
        
        this.renderLists();
    }
    
    updateUrl(listId) {
        const url = new URL(window.location.href);
        if (listId) {
            url.searchParams.set('list', listId);
        } else {
            url.searchParams.delete('list');
        }
        window.history.replaceState({}, '', url);
    }
    
    getCurrentList() {
        return this.lists.find(l => l.id === this.currentListId);
    }
    
    updateCurrentList(members, items) {
        const list = this.getCurrentList();
        if (list) {
            list.members = members;
            list.items = items;
            list.updatedAt = new Date().toISOString();
            this.saveLists();
        }
    }
    
    updateCreatorInfo(userId, userName, nickName, email) {
        // Update all members created by this user across all lists
        let hasChanges = false;
        
        this.lists.forEach(list => {
            (list.members || []).forEach(member => {
                if (member.createdBy === userId) {
                    if (userName !== undefined) member.creatorUserName = userName;
                    if (nickName !== undefined) member.creatorNickName = nickName;
                    if (email !== undefined) member.creatorEmail = email;
                    hasChanges = true;
                }
            });
        });
        
        if (hasChanges) {
            this.saveLists();
            // Update the current list editor if open
            if (this.listEditor) {
                const currentList = this.getCurrentList();
                if (currentList) {
                    this.listEditor.members = currentList.members;
                }
            }
        }
    }
    
    renderLists() {
        const isSignedIn = authManager?.isAuthenticated();
        
        if (!isSignedIn) {
            this.listsContainer.innerHTML = '<li class="empty-state">Sign in to view your lists.</li>';
            return;
        }
        
        const filteredLists = this.lists.filter(list => {
            if (this.isListRemovedForUser(list)) return false;
            const isArchivedForUser = this.isListArchivedForUser(list);
            return this.showArchived ? isArchivedForUser : !isArchivedForUser;
        });
        
        if (filteredLists.length === 0) {
            const message = this.showArchived 
                ? 'No archived lists.'
                : 'No lists yet. Create one to get started!';
            this.listsContainer.innerHTML = `<li class="empty-state">${message}</li>`;
            return;
        }
        
        // Split into "My lists" and "Shared with me"
        const myLists = filteredLists.filter(list => this.isUserOwnerOfList(list));
        const sharedLists = filteredLists.filter(list => !this.isUserOwnerOfList(list));
        
        let html = '';
        
        // Render "My lists" section
        if (myLists.length > 0) {
            html += `<li class="list-section-header">My lists</li>`;
            html += myLists.map(list => this.renderListItem(list, true, 'my-lists')).join('');
        }
        
        // Render "Shared with me" section
        if (sharedLists.length > 0) {
            html += `<li class="list-section-header">Shared with me</li>`;
            html += sharedLists.map(list => this.renderListItem(list, false, 'shared-lists')).join('');
        }
        
        this.listsContainer.innerHTML = html;
        this.setupListDragAndDrop();
    }
    
    setupListDragAndDrop() {
        const listItems = this.listsContainer.querySelectorAll('.list-item[data-list-id]');
        
        listItems.forEach(item => {
            const handle = item.querySelector('.list-drag-handle');
            if (!handle) return;
            
            handle.addEventListener('dragstart', (e) => this.onListDragStart(e, item));
            handle.addEventListener('dragend', () => this.onListDragEnd());
            
            item.addEventListener('dragover', (e) => this.onListDragOver(e, item));
            item.addEventListener('drop', (e) => this.onListDrop(e, item));
        });
    }
    
    onListDragStart(e, item) {
        this.draggedListId = item.dataset.listId;
        this.draggedListGroup = item.dataset.group;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.draggedListId);
    }
    
    onListDragEnd() {
        this.draggedListId = null;
        this.draggedListGroup = null;
        this.listsContainer.querySelectorAll('.list-item').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
        });
    }
    
    onListDragOver(e, item) {
        e.preventDefault();
        
        // Don't allow drop on items from different groups
        if (item.dataset.group !== this.draggedListGroup) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        
        e.dataTransfer.dropEffect = 'move';
        
        // Visual feedback
        this.listsContainer.querySelectorAll('.list-item').forEach(li => li.classList.remove('drag-over'));
        if (item.dataset.listId !== this.draggedListId) {
            item.classList.add('drag-over');
        }
    }
    
    onListDrop(e, targetItem) {
        e.preventDefault();
        
        const targetId = targetItem.dataset.listId;
        const targetGroup = targetItem.dataset.group;
        
        // Don't allow drop between different groups
        if (targetGroup !== this.draggedListGroup || targetId === this.draggedListId) {
            return;
        }
        
        // Reorder lists
        const draggedIndex = this.lists.findIndex(l => l.id === this.draggedListId);
        const targetIndex = this.lists.findIndex(l => l.id === targetId);
        
        if (draggedIndex === -1 || targetIndex === -1) return;
        
        // Remove dragged item and insert at target position
        const [draggedList] = this.lists.splice(draggedIndex, 1);
        const newTargetIndex = this.lists.findIndex(l => l.id === targetId);
        this.lists.splice(newTargetIndex, 0, draggedList);
        
        this.saveLists();
        this.renderLists();
    }
    
    renderListItem(list, isOwner, group = '') {
        const itemCount = list.items.length;
        const memberCount = (list.members || []).length;
        const visibilityIcon = list.shareToken 
            ? '<span class="list-visibility-icon" title="Link-enabled">🔗</span>' 
            : (isOwner ? '<span class="list-visibility-icon" title="Private">🔒</span>' : '');
        
        // Get owner name for shared lists
        const ownerName = list.ownerNickName || list.ownerUserName || 'Unknown';
        const ownerInfo = !isOwner ? `<span class="list-owner">by ${this.escapeHtml(ownerName)}</span>` : '';
        
        // Drag handle for active lists
        const dragHandle = !this.showArchived 
            ? '<span class="list-drag-handle" draggable="true" title="Drag to reorder">⋮⋮</span>' 
            : '';
        
        if (this.showArchived) {
            // Archived view - no drag handles
            if (isOwner) {
                return `
                    <li class="list-item archived" data-list-id="${list.id}" data-group="${group}">
                        ${visibilityIcon}<span class="list-name">${this.escapeHtml(list.name)}</span>
                        <span class="list-info">${itemCount} item${itemCount !== 1 ? 's' : ''} · ${memberCount} member${memberCount !== 1 ? 's' : ''}</span>
                        <button class="list-restore-btn" title="Restore list" aria-label="Restore list">↩</button>
                        <button class="list-delete-btn" title="Delete permanently (for everyone)" aria-label="Delete permanently">🗑</button>
                    </li>
                `;
            } else {
                // Shared lists in archive: only restore, no delete
                return `
                    <li class="list-item archived" data-list-id="${list.id}" data-group="${group}">
                        <span class="list-name">${this.escapeHtml(list.name)}</span>
                        <span class="list-info">${ownerInfo} · ${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
                        <button class="list-restore-btn" title="Restore list" aria-label="Restore list">↩</button>
                    </li>
                `;
            }
        }
        
        // Active view with drag handles
        if (isOwner) {
            return `
                <li class="list-item" data-list-id="${list.id}" data-group="${group}">
                    ${dragHandle}
                    ${visibilityIcon}<span class="list-name">${this.escapeHtml(list.name)}</span>
                    <span class="list-info">${itemCount} item${itemCount !== 1 ? 's' : ''} · ${memberCount} member${memberCount !== 1 ? 's' : ''}</span>
                    <div class="list-menu-container">
                        <button class="list-menu-btn" title="More options" aria-label="More options">⋮</button>
                        <ul class="list-menu-dropdown">
                            <li class="list-menu-item" data-action="rename">✎ Rename</li>
                            <li class="list-menu-item" data-action="share">⚙ Share settings</li>
                            <li class="list-menu-item" data-action="duplicate">⧉ Duplicate</li>
                            <li class="list-menu-item" data-action="export">↗ Export</li>
                            <li class="list-menu-item" data-action="archive">📥 Archive</li>
                            <li class="list-menu-item" data-action="delete">🗑 Delete</li>
                        </ul>
                    </div>
                </li>
            `;
        } else {
            // Shared lists: no rename, replace share settings with copy token
            const copyTokenOption = list.shareToken 
                ? `<li class="list-menu-item" data-action="copyToken">📋 Copy share code</li>` 
                : '';
            return `
                <li class="list-item" data-list-id="${list.id}" data-group="${group}">
                    ${dragHandle}
                    <span class="list-name">${this.escapeHtml(list.name)}</span>
                    <span class="list-info">${ownerInfo} · ${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
                    <div class="list-menu-container">
                        <button class="list-menu-btn" title="More options" aria-label="More options">⋮</button>
                        <ul class="list-menu-dropdown">
                            ${copyTokenOption}
                            <li class="list-menu-item" data-action="duplicate">⧉ Duplicate</li>
                            <li class="list-menu-item" data-action="export">↗ Export</li>
                            <li class="list-menu-item" data-action="archive">📥 Archive</li>
                        </ul>
                    </div>
                </li>
            `;
        }
    }
    
    startRenameList(listId) {
        if (!this.canMutate()) return;
        
        const list = this.lists.find(l => l.id === listId);
        if (!list) return;
        
        // Only owner can rename
        if (!this.isUserOwnerOfList(list)) {
            alert('Only the list owner can rename this list.');
            return;
        }
        
        const listItem = this.listsContainer.querySelector(`[data-list-id="${listId}"]`);
        if (!listItem) return;
        
        const nameSpan = listItem.querySelector('.list-name');
        const currentName = list.name;
        
        nameSpan.innerHTML = `<input type="text" class="list-name-input" value="${this.escapeHtml(currentName)}" />`;
        const input = nameSpan.querySelector('input');
        input.focus();
        input.select();
        
        let isFinishing = false;
        
        const finishRename = () => {
            if (isFinishing) return;
            isFinishing = true;
            
            const newName = input.value.trim();
            if (newName && newName !== currentName) {
                if (this.lists.some(l => l.id !== listId && l.name.toLowerCase() === newName.toLowerCase())) {
                    alert('A list with this name already exists.');
                    // Reset and let user try again
                    isFinishing = false;
                    input.value = currentName;
                    input.focus();
                    input.select();
                    return;
                }
                list.name = newName;
                list.updatedAt = new Date().toISOString();
                this.saveLists();
            }
            this.renderLists();
        };
        
        input.addEventListener('blur', finishRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            } else if (e.key === 'Escape') {
                isFinishing = true;
                this.renderLists();
            }
        });
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // === EXPORT ===

    exportList(listId) {
        const list = this.lists.find(l => l.id === listId);
        if (!list) {
            alert('List not found.');
            return;
        }

        const exportData = {
            exportVersion: 1,
            exportedAt: new Date().toISOString(),
            list: {
                name: list.name,
                createdAt: list.createdAt,
                updatedAt: list.updatedAt,
                members: list.members,
                items: list.items
            }
        };

        const json = JSON.stringify(exportData, null, 2);
        const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const filename = `${list.name}_${dateStr}.json`;
        
        this.downloadJsonFile(json, filename);
    }

    downloadJsonFile(json, filename) {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // === IMPORT ===

    importList() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        
        fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const json = await file.text();
                this.processImportJson(json);
            } catch (err) {
                alert('Failed to read file.');
            }
        };
        
        fileInput.click();
    }

    processImportJson(json) {
        if (!this.canMutate()) return;
        
        if (!json || !json.trim()) {
            alert('File is empty.');
            return;
        }
        
        let data;
        try {
            data = JSON.parse(json);
        } catch (err) {
            alert('Invalid JSON file: Could not parse JSON.');
            return;
        }
        
        const validation = this.validateImportData(data);
        if (!validation.valid) {
            alert(`Invalid import file: ${validation.error}`);
            return;
        }

        const importName = data.list.name;
        
        // Check for existing list with same name
        const conflict = this.lists.find(l => l.name.toLowerCase() === importName.toLowerCase());
        if (conflict) {
            const suggestedName = this.getUniqueCopyName(importName);
            const isArchived = conflict.archived;
            const archiveNote = isArchived ? ' (archived)' : '';
            
            const useSuggested = confirm(
                `A list named "${conflict.name}"${archiveNote} already exists.\n\n` +
                `Click OK to import as "${suggestedName}" instead.`
            );
            
            if (!useSuggested) {
                return;
            }
            
            data.list.name = suggestedName;
        }

        const normalizedList = this.normalizeImportedList(data.list);
        
        this.lists.push(normalizedList);
        this.saveLists();
        this.renderLists();
        alert(`List "${normalizedList.name}" imported successfully!`);
    }

    validateImportData(data) {
        if (!data || typeof data !== 'object') {
            return { valid: false, error: 'Data must be an object' };
        }

        if (data.exportVersion !== 1) {
            return { valid: false, error: 'Unsupported export version. Expected exportVersion: 1' };
        }

        if (!data.list || typeof data.list !== 'object') {
            return { valid: false, error: 'Missing or invalid "list" property' };
        }

        const list = data.list;

        if (!list.name || typeof list.name !== 'string') {
            return { valid: false, error: 'List must have a name (string)' };
        }

        // Validate members array
        if (list.members !== undefined && !Array.isArray(list.members)) {
            return { valid: false, error: 'Members must be an array' };
        }

        // Validate each member has id and valid role
        const validRoles = ['owner', 'editor', 'viewer'];
        if (Array.isArray(list.members)) {
            for (let i = 0; i < list.members.length; i++) {
                const member = list.members[i];
                if (!member || typeof member !== 'object') {
                    return { valid: false, error: `Member at index ${i} is invalid` };
                }
                if (!member.id) {
                    return { valid: false, error: `Member at index ${i} is missing id` };
                }
                if (member.role && !validRoles.includes(member.role)) {
                    return { valid: false, error: `Member at index ${i} has invalid role "${member.role}". Valid roles: ${validRoles.join(', ')}` };
                }
            }
        }

        // Validate items array
        if (list.items !== undefined && !Array.isArray(list.items)) {
            return { valid: false, error: 'Items must be an array' };
        }

        // Validate each item has id
        if (Array.isArray(list.items)) {
            for (let i = 0; i < list.items.length; i++) {
                const item = list.items[i];
                if (!item || typeof item !== 'object') {
                    return { valid: false, error: `Item at index ${i} is invalid` };
                }
                if (!item.id) {
                    return { valid: false, error: `Item at index ${i} is missing id` };
                }
            }
        }

        return { valid: true };
    }

    normalizeImportedList(importedList) {
        const now = new Date().toISOString();
        const listName = importedList.name;
        
        // Generate new members with new UUIDs
        const oldMembers = importedList.members || [];
        const memberIdMap = {};
        
        let newMembers = oldMembers.map(m => {
            const newId = generateUUID();
            memberIdMap[m.id] = newId;
            return {
                id: newId,
                name: m.name || 'Unknown',
                role: m.role || 'editor'
            };
        });
        
        // Ensure at least one member exists
        if (newMembers.length === 0) {
            newMembers = [{
                id: generateUUID(),
                name: 'me',
                role: 'owner'
            }];
        }
        
        // Ensure exactly one owner
        const owners = newMembers.filter(m => m.role === 'owner');
        if (owners.length === 0) {
            newMembers[0] = { ...newMembers[0], role: 'owner' };
        } else if (owners.length > 1) {
            let foundFirst = false;
            newMembers = newMembers.map(member => {
                if (member.role === 'owner') {
                    if (!foundFirst) {
                        foundFirst = true;
                        return member;
                    }
                    return { ...member, role: 'editor' };
                }
                return member;
            });
        }

        // Generate new items with remapped member IDs
        const oldItems = importedList.items || [];
        const newItems = oldItems.map(item => {
            const newItem = {
                id: generateUUID(),
                text: item.text || '',
                comment: item.comment || '',
                quantity: {},
                done: {}
            };

            // Remap quantity keys to new member IDs
            if (item.quantity && typeof item.quantity === 'object') {
                Object.keys(item.quantity).forEach(oldMemberId => {
                    const newMemberId = memberIdMap[oldMemberId];
                    if (newMemberId) {
                        newItem.quantity[newMemberId] = item.quantity[oldMemberId];
                    }
                });
            }

            // Remap done keys to new member IDs
            if (item.done && typeof item.done === 'object') {
                Object.keys(item.done).forEach(oldMemberId => {
                    const newMemberId = memberIdMap[oldMemberId];
                    if (newMemberId) {
                        newItem.done[newMemberId] = item.done[oldMemberId];
                    }
                });
            }

            return newItem;
        });

        return {
            id: generateUUID(),
            name: listName,
            createdAt: now,
            updatedAt: now,
            members: newMembers,
            items: newItems
        };
    }
}

// ============================================
// FAMILIST - Individual list editor
// ============================================
class FamiList {
    constructor(listManager) {
        this.listManager = listManager;
        
        // Load state from current list
        const list = listManager.getCurrentList();
        this.members = list.members || [];
        this.items = this.migrateItems(list.items || [], this.members);
        
        this.hideDone = {}; // { memberId: boolean }
        this.editingId = null;
        this.editingCommentId = null;
        this.draggedId = null;
        this.dropBeforeId = null;
        this.itemInput = document.getElementById('itemInput');
        this.addButton = document.getElementById('addButton');
        this.itemList = document.getElementById('itemList');
        this.headerRow = document.getElementById('headerRow');
        this.footerRow = document.getElementById('footerRow');
        this.dropIndicator = null;
        
        // Archive view toggle
        this.showArchivedItems = false;
        this.showActiveItemsBtn = document.getElementById('showActiveItemsBtn');
        this.showArchivedItemsBtn = document.getElementById('showArchivedItemsBtn');
        
        // Autocomplete
        this.autocompleteList = document.getElementById('autocompleteList');
        this.autocompleteHighlightIndex = -1;
        this.autocompleteSuggestions = [];
        
        // Dirty state tracking
        this.isDirty = false;
        
        // Debounced save for rapid edits
        this.saveStateDebounced = debounce(() => {
            this.saveState();
            this.isDirty = false;
        }, SAVE_DEBOUNCE_MS);

        // Initialize hideDone flags for each member
        this.members.forEach(p => {
            this.hideDone[p.id] = false;
        });
        
        this.init();
    }
    
    init() {
        // Remove old listeners by cloning elements
        const newAddButton = this.addButton.cloneNode(true);
        this.addButton.parentNode.replaceChild(newAddButton, this.addButton);
        this.addButton = newAddButton;
        
        const newItemInput = this.itemInput.cloneNode(true);
        this.itemInput.parentNode.replaceChild(newItemInput, this.itemInput);
        this.itemInput = newItemInput;
        
        const newItemList = this.itemList.cloneNode(true);
        this.itemList.parentNode.replaceChild(newItemList, this.itemList);
        this.itemList = newItemList;
        
        this.addButton.addEventListener('click', () => this.addItem());
        this.itemInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (this.autocompleteHighlightIndex >= 0 && this.autocompleteSuggestions.length > 0) {
                    e.preventDefault();
                    this.selectAutocompleteSuggestion(this.autocompleteHighlightIndex);
                } else {
                    this.hideAutocomplete();
                    this.addItem();
                }
            }
        });
        
        // Autocomplete input events
        this.itemInput.addEventListener('input', () => this.onAutocompleteInput());
        this.itemInput.addEventListener('keydown', (e) => this.onAutocompleteKeydown(e));
        this.itemInput.addEventListener('blur', (e) => {
            setTimeout(() => this.hideAutocomplete(), 150);
        });
        this.itemInput.addEventListener('focus', () => {
            if (this.itemInput.value.trim().length > 0) {
                this.onAutocompleteInput();
            }
        });
        
        // Autocomplete list click handler (mousedown to fire before blur)
        this.autocompleteList.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const item = e.target.closest('.autocomplete-item');
            if (item) {
                const index = parseInt(item.dataset.index, 10);
                this.selectAutocompleteSuggestion(index);
            }
        });

        // Drag & drop reordering
        this.itemList.addEventListener('dragstart', (e) => this.onDragStart(e));
        this.itemList.addEventListener('dragover', (e) => this.onDragOver(e));
        this.itemList.addEventListener('drop', (e) => this.onDrop(e));
        this.itemList.addEventListener('dragend', () => this.onDragEnd());

        // Event delegation for item list
        this.itemList.addEventListener('click', (e) => this.handleItemListClick(e));
        this.itemList.addEventListener('blur', (e) => this.handleItemListBlur(e), true);
        this.itemList.addEventListener('focus', (e) => this.handleItemListFocus(e), true);
        this.itemList.addEventListener('keydown', (e) => this.handleItemListKeydown(e));

        this.dropIndicator = document.createElement('div');
        this.dropIndicator.className = 'drop-indicator';

        // Item view toggle listeners (tablist pattern)
        this.showActiveItemsBtn.addEventListener('click', () => this.setItemViewMode(false));
        this.showArchivedItemsBtn.addEventListener('click', () => this.setItemViewMode(true));
        this.setupTablistKeyboard(this.showActiveItemsBtn.parentElement, [this.showActiveItemsBtn, this.showArchivedItemsBtn], (index) => {
            this.setItemViewMode(index === 1);
        });

        // Save button handler
        this.saveButton = document.getElementById('saveListButton');
        if (this.saveButton) {
            const newSaveButton = this.saveButton.cloneNode(true);
            this.saveButton.parentNode.replaceChild(newSaveButton, this.saveButton);
            this.saveButton = newSaveButton;
            this.saveButton.addEventListener('click', () => this.saveToSupabase());
        }

        this.renderHeader();
        this.renderFooter();
        this.updateGridColumns();
        this.render();
    }
    
    setupTablistKeyboard(container, tabs, onSelect) {
        container.addEventListener('keydown', (e) => {
            const currentIndex = tabs.findIndex(tab => tab === document.activeElement);
            if (currentIndex === -1) return;
            
            let newIndex = currentIndex;
            
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                newIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                newIndex = currentIndex === tabs.length - 1 ? 0 : currentIndex + 1;
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(currentIndex);
                return;
            } else if (e.key === 'Home') {
                e.preventDefault();
                newIndex = 0;
            } else if (e.key === 'End') {
                e.preventDefault();
                newIndex = tabs.length - 1;
            } else {
                return;
            }
            
            tabs[newIndex].focus();
            onSelect(newIndex);
        });
    }
    
    setItemViewMode(showArchived) {
        this.showArchivedItems = showArchived;
        this.showActiveItemsBtn.classList.toggle('active', !showArchived);
        this.showArchivedItemsBtn.classList.toggle('active', showArchived);
        this.showActiveItemsBtn.setAttribute('aria-selected', !showArchived);
        this.showArchivedItemsBtn.setAttribute('aria-selected', showArchived);
        this.showActiveItemsBtn.setAttribute('tabindex', showArchived ? '-1' : '0');
        this.showArchivedItemsBtn.setAttribute('tabindex', showArchived ? '0' : '-1');
        this.render();
    }

    // === AUTOCOMPLETE ===
    
    getAutocompleteSuggestions(query) {
        if (!query || query.length < 1) return [];
        
        const lowerQuery = query.toLowerCase();
        const frequencyMap = new Map();
        
        const lists = this.listManager.lists;
        for (const list of lists) {
            const items = list.items || [];
            for (const item of items) {
                const text = item.text.trim();
                const lowerText = text.toLowerCase();
                
                if (lowerText.includes(lowerQuery)) {
                    const key = lowerText;
                    const existing = frequencyMap.get(key);
                    if (existing) {
                        existing.count++;
                    } else {
                        frequencyMap.set(key, { text, count: 1 });
                    }
                }
            }
        }
        
        const suggestions = Array.from(frequencyMap.values())
            .sort((a, b) => {
                const aStartsWith = a.text.toLowerCase().startsWith(lowerQuery);
                const bStartsWith = b.text.toLowerCase().startsWith(lowerQuery);
                if (aStartsWith && !bStartsWith) return -1;
                if (!aStartsWith && bStartsWith) return 1;
                if (b.count !== a.count) return b.count - a.count;
                return a.text.localeCompare(b.text);
            })
            .slice(0, 8);
        
        return suggestions;
    }
    
    onAutocompleteInput() {
        const query = this.itemInput.value.trim();
        this.autocompleteSuggestions = this.getAutocompleteSuggestions(query);
        
        if (this.autocompleteSuggestions.length === 0) {
            this.hideAutocomplete();
            return;
        }
        
        this.renderAutocomplete(query);
        this.showAutocomplete();
    }
    
    onAutocompleteKeydown(e) {
        if (!this.autocompleteList.classList.contains('visible')) return;
        
        const maxIndex = this.autocompleteSuggestions.length - 1;
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.autocompleteHighlightIndex = Math.min(this.autocompleteHighlightIndex + 1, maxIndex);
                this.updateAutocompleteHighlight();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.autocompleteHighlightIndex = Math.max(this.autocompleteHighlightIndex - 1, -1);
                this.updateAutocompleteHighlight();
                break;
            case 'Escape':
                e.preventDefault();
                this.hideAutocomplete();
                break;
            case 'Tab':
                if (this.autocompleteSuggestions.length > 0) {
                    e.preventDefault();
                    const indexToSelect = this.autocompleteHighlightIndex >= 0 
                        ? this.autocompleteHighlightIndex 
                        : 0;
                    this.selectAutocompleteSuggestion(indexToSelect);
                }
                break;
        }
    }
    
    renderAutocomplete(query) {
        const lowerQuery = query.toLowerCase();
        this.autocompleteList.innerHTML = this.autocompleteSuggestions.map((suggestion, index) => {
            const text = this.escapeHtml(suggestion.text);
            const highlightedText = this.highlightMatch(text, lowerQuery);
            
            return `
                <li class="autocomplete-item${index === this.autocompleteHighlightIndex ? ' highlighted' : ''}" 
                    data-index="${index}" 
                    role="option"
                    aria-selected="${index === this.autocompleteHighlightIndex}">
                    <span class="autocomplete-item-text">${highlightedText}</span>
                </li>
            `;
        }).join('');
    }
    
    highlightMatch(text, query) {
        const lowerText = text.toLowerCase();
        const index = lowerText.indexOf(query);
        if (index === -1) return text;
        
        const before = text.substring(0, index);
        const match = text.substring(index, index + query.length);
        const after = text.substring(index + query.length);
        
        return `${before}<mark>${match}</mark>${after}`;
    }
    
    showAutocomplete() {
        this.autocompleteList.classList.add('visible');
        this.itemInput.setAttribute('aria-expanded', 'true');
    }
    
    hideAutocomplete() {
        this.autocompleteList.classList.remove('visible');
        this.autocompleteList.innerHTML = '';
        this.autocompleteHighlightIndex = -1;
        this.autocompleteSuggestions = [];
        this.itemInput.setAttribute('aria-expanded', 'false');
    }
    
    updateAutocompleteHighlight() {
        const items = this.autocompleteList.querySelectorAll('.autocomplete-item');
        items.forEach((item, index) => {
            const isHighlighted = index === this.autocompleteHighlightIndex;
            item.classList.toggle('highlighted', isHighlighted);
            item.setAttribute('aria-selected', isHighlighted);
        });
        
        if (this.autocompleteHighlightIndex >= 0 && items[this.autocompleteHighlightIndex]) {
            items[this.autocompleteHighlightIndex].scrollIntoView({ block: 'nearest' });
        }
    }
    
    selectAutocompleteSuggestion(index) {
        if (index < 0 || index >= this.autocompleteSuggestions.length) return;
        
        const suggestion = this.autocompleteSuggestions[index];
        this.itemInput.value = suggestion.text;
        this.hideAutocomplete();
        this.itemInput.focus();
    }

    // === EVENT DELEGATION HANDLERS ===

    handleItemListClick(e) {
        const listItem = e.target.closest('li[data-id]');
        const commentSection = e.target.closest('.comment-section');
        
        // Handle clicks within comment section
        if (commentSection) {
            const itemId = commentSection.dataset.commentId;
            if (e.target.closest('.comment-save-btn')) {
                this.saveComment(itemId);
                return;
            }
            if (e.target.closest('.comment-cancel-btn')) {
                this.cancelComment(itemId);
                return;
            }
            return;
        }
        
        if (!listItem) return;
        
        const itemId = listItem.dataset.id;
        
        // Done button click
        const doneButton = e.target.closest('.done-button');
        if (doneButton) {
            const memberCell = doneButton.closest('.member-cell');
            const quantityInput = memberCell?.querySelector('.quantity-input');
            if (quantityInput) {
                const memberId = quantityInput.dataset.memberId;
                this.toggleMemberDone(itemId, memberId);
            }
            return;
        }
        
        // Comment button click
        if (e.target.closest('.comment-button')) {
            this.toggleComment(itemId);
            return;
        }
        
        // Delete button click (archive)
        if (e.target.closest('.delete-button')) {
            this.deleteItem(itemId);
            return;
        }
        
        // Restore button click (for archived items)
        if (e.target.closest('.restore-button')) {
            this.restoreItem(itemId);
            return;
        }
        
        // Permanent delete button click (for archived items)
        if (e.target.closest('.permanent-delete-button')) {
            this.permanentlyDeleteItem(itemId);
            return;
        }
        
        // Item text click (start editing) - only for active items
        if (e.target.closest('.item-text') && !this.showArchivedItems) {
            this.startEdit(itemId);
            return;
        }
    }

    handleItemListBlur(e) {
        // Handle quantity input blur
        const quantityInput = e.target.closest('.quantity-input');
        if (quantityInput) {
            const itemId = quantityInput.dataset.itemId;
            const memberId = quantityInput.dataset.memberId;
            if (itemId && memberId) {
                this.setQuantity(itemId, memberId, quantityInput.value);
            }
            return;
        }
    }

    handleItemListFocus(e) {
        // Handle quantity input focus - store original value
        const quantityInput = e.target.closest('.quantity-input');
        if (quantityInput) {
            quantityInput.dataset.original = quantityInput.value;
            return;
        }
    }

    handleItemListKeydown(e) {
        // Handle quantity input keydown
        const quantityInput = e.target.closest('.quantity-input');
        if (quantityInput) {
            const itemId = quantityInput.dataset.itemId;
            const memberId = quantityInput.dataset.memberId;
            if (itemId && memberId) {
                this.handleQuantityKey(e, itemId, memberId);
            }
            return;
        }
    }

    // === STATE PERSISTENCE ===

    migrateItems(items, members) {
        return items.map(item => {
            if (item && typeof item === 'object') {
                if (!item.quantity) item.quantity = {};
                if (!item.done) item.done = {};
                if (item.comment === undefined) item.comment = '';

                members.forEach(p => {
                    if (item.quantity[p.id] === undefined) {
                        if (item.relevance && item.relevance[p.id] !== undefined) {
                            item.quantity[p.id] = item.relevance[p.id] ? 1 : 0;
                        } else {
                            item.quantity[p.id] = 1;
                        }
                    }
                    if (item.done[p.id] === undefined) {
                        item.done[p.id] = false;
                    }
                });

                delete item.completed;
                delete item.relevance;
            }
            return item;
        });
    }

    saveState() {
        this.listManager.updateCurrentList(this.members, this.items);
    }
    
    async saveToSupabase() {
        if (!authManager?.isAuthenticated()) {
            throw new Error('Please sign in to save changes to the cloud.');
        }
        
        // Save local state first
        this.saveState();
        
        // Update button state
        if (this.saveButton) {
            this.saveButton.disabled = true;
            this.saveButton.textContent = 'Saving...';
        }
        
        try {
            const list = this.listManager.getCurrentList();
            if (list) {
                await this.listManager.syncListToSupabase(list);
                
                // Update the initial snapshot to current state after successful save
                this.listManager.initialListSnapshot = this.listManager.createListContentSnapshot(list);
            }
            
            if (this.saveButton) {
                this.saveButton.textContent = 'Saved!';
                setTimeout(() => {
                    this.saveButton.textContent = 'Save Changes';
                    this.saveButton.disabled = false;
                }, 2000);
            }
        } catch (err) {
            SupabaseLog.logError('Save to Supabase', err.message);
            
            if (this.saveButton) {
                this.saveButton.textContent = 'Save Changes';
                this.saveButton.disabled = false;
            }
            
            // Re-throw so callers can handle it
            throw err;
        }
    }
    
    canMutate() {
        return this.listManager.canMutate();
    }
    
    markDirtyAndSave() {
        if (!this.listManager.storageHealthy) return;
        this.isDirty = true;
        this.saveStateDebounced();
    }
    
    hasPendingChanges() {
        return this.isDirty;
    }

    // === MEMBERS MANAGEMENT ===

    canAddMember() {
        return this.members.length < 8;
    }

    isNameTaken(name, excludeId = null) {
        const normalizedName = name.trim().toLowerCase();
        return this.members.some(p => 
            p.id !== excludeId && p.name.trim().toLowerCase() === normalizedName
        );
    }

    generateMemberId() {
        return generateUUID();
    }

    addMember(name) {
        if (!this.canMutate()) return false;
        if (!this.canAddMember()) {
            alert('Maximum 8 members allowed.');
            return false;
        }
        const trimmedName = name.trim();
        if (!trimmedName) {
            return false;
        }
        if (this.isNameTaken(trimmedName)) {
            alert('A member with this name already exists.');
            return false;
        }

        const userId = authManager?.getUserId();
        const profile = userId ? authManager.getUserProfile(userId) : null;
        
        // Get the current user's role to inherit for the new member
        const currentUserMember = this.members.find(m => m.createdBy === userId);
        const inheritedRole = currentUserMember?.role || 'editor';
        
        const newMember = {
            id: this.generateMemberId(),
            name: trimmedName,
            role: inheritedRole,
            createdBy: userId,
            creatorUserName: profile?.userName,
            creatorNickName: profile?.nickName,
            creatorEmail: authManager?.user?.email
        };

        this.members.push(newMember);
        this.hideDone[newMember.id] = false;

        // Add default values for existing items
        this.items.forEach(item => {
            if (!item.quantity) item.quantity = {};
            if (!item.done) item.done = {};
            item.quantity[newMember.id] = 1;
            item.done[newMember.id] = false;
        });

        this.saveState();
        this.renderHeader();
        this.renderFooter();
        this.updateGridColumns();
        this.render();
        return true;
    }

    updateMemberName(memberId, newName) {
        const trimmedName = newName.trim();
        if (!trimmedName) return false;
        
        if (this.isNameTaken(trimmedName, memberId)) {
            alert('A member with this name already exists.');
            return false;
        }

        const member = this.members.find(p => p.id === memberId);
        if (member) {
            member.name = trimmedName;
            this.markDirtyAndSave();
            return true;
        }
        return false;
    }

    async deleteMember(memberId) {
        if (!this.canMutate()) return;
        
        const member = this.members.find(p => p.id === memberId);
        if (!member) return;

        // Prevent deleting the last owner
        if (member.role === 'owner') {
            const ownerCount = this.members.filter(m => m.role === 'owner').length;
            if (ownerCount <= 1) {
                alert('Cannot delete the last owner. Assign another owner first.');
                return;
            }
        }

        if (!confirm(`Delete "${member.name}" and all their data?`)) {
            return;
        }

        // Remove member from list
        this.members = this.members.filter(p => p.id !== memberId);
        delete this.hideDone[memberId];

        // Remove member data from all items
        this.items.forEach(item => {
            if (item.quantity) delete item.quantity[memberId];
            if (item.done) delete item.done[memberId];
        });

        // Delete from Supabase
        if (this.listManager.syncEnabled && authManager?.isAuthenticated()) {
            const currentList = this.listManager.getCurrentList();
            if (currentList) {
                await this.listManager.deleteMemberFromSupabase(currentList.id, memberId);
            }
        }

        this.saveState();
        this.renderHeader();
        this.renderFooter();
        this.updateGridColumns();
        this.render();
    }

    // === GRID COLUMNS ===

    updateGridColumns() {
        const memberCount = this.members.length;
        // Format: 24px(drag) 200px(text) [80px(member) 20px(spacer)]... 40px(spacer) 30px(comment) 40px(delete)
        // But last member doesn't need spacer after it
        let columns = '24px 200px';
        this.members.forEach((_, index) => {
            columns += ' 80px';
            if (index < this.members.length - 1) {
                columns += ' 20px'; // spacer between members
            }
        });
        columns += ' 40px'; // spacer before buttons (doubled for better separation)
        columns += ' 30px'; // comment button
        columns += ' 40px'; // delete button

        document.documentElement.style.setProperty('--grid-columns', columns);
        
        // Apply to existing elements
        const elements = document.querySelectorAll('.list-header, .footer-grid, .item-list li');
        elements.forEach(el => {
            el.style.gridTemplateColumns = columns;
        });
    }

    // === HEADER RENDERING ===

    renderHeader() {
        if (!this.headerRow) return;

        let html = `
            <div class="list-header-spacer"></div>
            <div class="list-header-item"></div>
        `;

        this.members.forEach((member, index) => {
            html += `
                <div class="list-header-member">
                    <span class="delete-member-btn" data-member-id="${member.id}" title="Delete ${this.escapeHtml(member.name)}" aria-label="Delete member ${this.escapeHtml(member.name)}" role="button" tabindex="0">✕</span>
                    <span class="member-edit-btn" data-member-id="${member.id}" title="Edit member name" aria-label="Edit member name" role="button" tabindex="0">✎</span>
                    <span class="editable-name member-name-clickable" data-member-id="${member.id}">${this.escapeHtml(member.name)}</span>
                </div>
            `;
            if (index < this.members.length - 1) {
                html += '<div></div>'; // spacer
            }
        });

        // Spacer before action columns
        html += '<div></div>';
        
        // Add Member button spans comment and action columns
        if (this.canAddMember()) {
            html += `<div class="add-member-cell" style="grid-column: span 2; text-align: right;"><span class="add-member-btn">New Member</span></div>`;
        } else {
            html += '<div></div>'; // comment column
            html += '<div></div>'; // action column
        }

        this.headerRow.innerHTML = html;

        // Attach click handlers: member name -> show profile modal, pencil -> edit name
        this.headerRow.querySelectorAll('.editable-name').forEach(el => {
            el.addEventListener('click', () => this.showMemberProfile(el.dataset.memberId));
        });

        this.headerRow.querySelectorAll('.member-edit-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.startEditMemberName(el.dataset.memberId);
            });
        });

        // Attach delete member handlers
        this.headerRow.querySelectorAll('.delete-member-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteMember(el.dataset.memberId);
            });
        });

        // Attach Add Member handler
        const addBtn = this.headerRow.querySelector('.add-member-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.startAddMember());
        }
    }
    
    showMemberProfile(memberId) {
        const member = this.members.find(m => m.id === memberId);
        if (!member) return;
        
        const modal = document.getElementById('memberProfileModal');
        const creatorUserNameEl = document.getElementById('memberProfileCreatorUserName');
        const creatorNickNameEl = document.getElementById('memberProfileCreatorNickName');
        const roleEl = document.getElementById('memberProfileRole');
        
        if (!modal || !creatorUserNameEl || !creatorNickNameEl) return;
        
        const currentUserId = authManager?.getUserId();
        const creatorId = member.createdBy;
        const isCreatorCurrentUser = creatorId === currentUserId;
        
        let creatorUserName = member.creatorUserName || null;
        let creatorNickName = member.creatorNickName || null;
        let creatorEmail = member.creatorEmail || null;
        
        // If the creator is the current user, always use their current profile
        // (not the snapshot stored when the member was created)
        if (isCreatorCurrentUser && authManager?.user) {
            const profile = authManager.getUserProfile(currentUserId);
            creatorUserName = profile?.userName || creatorUserName || null;
            creatorNickName = profile?.nickName || creatorNickName || null;
            creatorEmail = authManager.user?.email || creatorEmail || null;
        }
        
        creatorUserNameEl.textContent = creatorUserName || '-';
        creatorNickNameEl.textContent = creatorNickName || '-';
        
        if (roleEl) {
            const roleDisplay = member.role ? member.role.charAt(0).toUpperCase() + member.role.slice(1) : '-';
            roleEl.textContent = roleDisplay;
        }
        
        modal.style.display = 'flex';
    }

    cycleRole(memberId) {
        const member = this.members.find(m => m.id === memberId);
        if (!member) return;

        // Prevent changing role if this is the last owner
        if (member.role === 'owner') {
            const ownerCount = this.members.filter(m => m.role === 'owner').length;
            if (ownerCount <= 1) {
                alert('Cannot change role of the last owner. Assign another owner first.');
                return;
            }
        }

        const currentIndex = MEMBER_ROLES.indexOf(member.role || 'editor');
        const nextIndex = (currentIndex + 1) % MEMBER_ROLES.length;
        member.role = MEMBER_ROLES[nextIndex];

        this.markDirtyAndSave();
        this.renderHeader();
    }

    startEditMemberName(memberId) {
        const el = this.headerRow.querySelector(`.editable-name[data-member-id="${memberId}"]`);
        const member = this.members.find(p => p.id === memberId);
        if (!el || !member) return;

        if (el.querySelector('input')) return;

        const currentName = member.name;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'member-name-input';

        el.textContent = '';
        el.appendChild(input);
        input.focus();
        input.select();

        input.addEventListener('click', (e) => e.stopPropagation());

        const saveEdit = () => {
            const newName = input.value.trim() || currentName;
            if (newName !== currentName) {
                if (!this.updateMemberName(memberId, newName)) {
                    // Restore old name if update failed
                    el.textContent = currentName;
                    return;
                }
            }
            el.textContent = newName;
        };

        input.addEventListener('blur', saveEdit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            } else if (e.key === 'Escape') {
                input.value = currentName;
                input.blur();
            }
        });
    }

    startAddMember() {
        const addBtn = this.headerRow.querySelector('.add-member-btn');
        if (!addBtn) return;

        const cell = addBtn.parentElement;
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Name...';
        input.className = 'member-name-input';

        cell.innerHTML = '';
        cell.appendChild(input);
        input.focus();

        input.addEventListener('click', (e) => e.stopPropagation());

        const finishAdd = () => {
            const name = input.value.trim();
            if (name) {
                this.addMember(name);
            } else {
                this.renderHeader();
            }
        };

        input.addEventListener('blur', finishAdd);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            } else if (e.key === 'Escape') {
                this.renderHeader();
            }
        });
    }

    // === FOOTER RENDERING ===

    renderFooter() {
        if (!this.footerRow) return;

        let html = `
            <div></div>
            <div></div>
        `;

        this.members.forEach((member, index) => {
            const isChecked = this.hideDone[member.id] ? 'checked' : '';
            html += `
                <label class="toggle">
                    <input type="checkbox" data-member-id="${member.id}" ${isChecked}>
                    <span class="toggle-slider"></span>
                </label>
            `;
            if (index < this.members.length - 1) {
                html += '<div></div>'; // spacer
            }
        });

        html += '<div class="footer-label">Hide Done</div>';
        html += '<div></div>'; // spacer before buttons
        html += '<div></div>'; // for comment column alignment
        html += '<div></div>'; // for delete column alignment

        this.footerRow.innerHTML = html;

        // Attach change handlers
        this.footerRow.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const memberId = checkbox.dataset.memberId;
                this.hideDone[memberId] = checkbox.checked;
                this.render();
            });
        });
    }

    // === ITEMS ===
    
    isItemNameTaken(name, excludeId = null) {
        const lowerName = name.toLowerCase();
        return this.items.some(item => 
            item.text.toLowerCase() === lowerName && item.id !== excludeId
        );
    }

    addItem() {
        if (!this.canMutate()) return;
        
        this.hideAutocomplete();
        
        const text = this.itemInput.value.trim();
        if (text === '') return;

        // Check for existing item (active or archived) with same name
        const conflict = this.items.find(i => i.text.toLowerCase() === text.toLowerCase());
        if (conflict) {
            const suggestedName = this.getUniqueItemCopyName(text);
            const isArchived = conflict.archived;
            const archiveNote = isArchived ? ' (archived)' : '';
            
            const useSuggested = confirm(
                `An item named "${conflict.text}"${archiveNote} already exists.\n\n` +
                `Click OK to add as "${suggestedName}" instead.`
            );
            
            if (useSuggested) {
                this.doAddItem(suggestedName);
            }
            return;
        }

        this.doAddItem(text);
    }
    
    doAddItem(text) {
        const item = {
            id: generateUUID(),
            text: text,
            quantity: {},
            done: {},
            comment: ''
        };

        // Initialize for all members with quantity=1 and done=false
        this.members.forEach(p => {
            item.quantity[p.id] = 1;
            item.done[p.id] = false;
        });

        this.items.push(item);
        this.saveState();
        this.render();

        this.itemInput.value = '';
        this.itemInput.focus();
    }
    
    deleteItem(id) {
        if (!this.canMutate()) return;
        
        const item = this.items.find(item => item.id === id);
        if (!item) return;
        
        // Archive instead of delete
        item.archived = true;
        item.archivedAt = new Date().toISOString();
        this.saveState();

        const li = this.itemList.querySelector(`li[data-id="${id}"]`);
        if (li) li.remove();

        const activeItems = this.items.filter(i => !i.archived);
        if (activeItems.length === 0) {
            this.render();
        }
    }
    
    restoreItem(id) {
        if (!this.canMutate()) return;
        
        const item = this.items.find(item => item.id === id);
        if (!item) return;
        
        // Check for name conflict with active items
        const conflict = this.items.find(i => !i.archived && i.id !== id && i.text.toLowerCase() === item.text.toLowerCase());
        if (conflict) {
            const suggestedName = this.getUniqueItemCopyName(item.text);
            const useSuggested = confirm(
                `An active item named "${conflict.text}" already exists.\n\n` +
                `Click OK to restore as "${suggestedName}" instead.`
            );
            if (useSuggested) {
                item.text = suggestedName;
            } else {
                return;
            }
        }
        
        item.archived = false;
        delete item.archivedAt;
        this.saveState();
        this.render();
    }
    
    async permanentlyDeleteItem(id) {
        if (!this.canMutate()) return;
        
        const item = this.items.find(item => item.id === id);
        if (!item) return;
        
        if (!confirm(`Permanently delete "${item.text}"? This cannot be undone.`)) return;
        
        this.items = this.items.filter(item => item.id !== id);
        
        // Delete from Supabase
        if (this.listManager.syncEnabled && authManager?.isAuthenticated()) {
            await this.listManager.deleteItemFromSupabase(id);
        }
        
        this.saveState();
        this.render();
    }
    
    getUniqueItemCopyName(baseName) {
        let name = `${baseName} (Copy)`;
        
        if (!this.items.some(i => i.text.toLowerCase() === name.toLowerCase())) {
            return name;
        }
        
        let counter = 2;
        while (this.items.some(i => i.text.toLowerCase() === name.toLowerCase())) {
            name = `${baseName} (Copy ${counter})`;
            counter++;
        }
        
        return name;
    }
    
    isFullyDone(item) {
        // An item is fully done when all members with quantity > 0 are marked as done
        return this.members.every(p => {
            const qty = item?.quantity?.[p.id] || 0;
            const done = item?.done?.[p.id] || false;
            // If quantity is 0, it doesn't count. If quantity > 0, must be done.
            return qty === 0 || done;
        });
    }

    getMemberCellIndex(memberId) {
        return this.members.findIndex(p => p.id === memberId);
    }

    updateItemCompletedClass(li, item) {
        if (this.isFullyDone(item)) {
            li.classList.add('completed');
        } else {
            li.classList.remove('completed');
        }
    }

    toggleMemberDone(itemId, memberId) {
        const item = this.items.find(item => item.id === itemId);
        if (!item) return;

        if (!item.done) item.done = {};
        item.done[memberId] = !item.done[memberId];
        this.markDirtyAndSave();

        // Check if item should now be hidden
        if (!this.shouldItemBeVisible(item)) {
            const li = this.itemList.querySelector(`li[data-id="${itemId}"]`);
            if (li) li.remove();
            return;
        }

        const li = this.itemList.querySelector(`li[data-id="${itemId}"]`);
        if (li) {
            const memberCells = li.querySelectorAll('.member-cell');
            const cellIndex = this.getMemberCellIndex(memberId);
            const cell = memberCells[cellIndex];
            if (cell) {
                const doneBtn = cell.querySelector('.done-button');
                if (doneBtn) {
                    doneBtn.classList.toggle('done-active', item.done[memberId]);
                }
            }
            this.updateItemCompletedClass(li, item);
        }
    }
    
    shouldItemBeVisible(item) {
        // Check archive status
        const isArchived = !!item.archived;
        if (this.showArchivedItems !== isArchived) return false;
        
        // Check hideDone filter
        for (const member of this.members) {
            if (this.hideDone[member.id]) {
                const qty = item?.quantity?.[member.id] || 0;
                const done = !!item?.done?.[member.id];
                if (qty === 0 || done) return false;
            }
        }
        return true;
    }

    incrementQuantity(itemId, memberId) {
        const item = this.items.find(item => item.id === itemId);
        if (!item) return;

        if (!item.quantity) item.quantity = {};
        item.quantity[memberId] = (item.quantity[memberId] || 0) + 1;
        this.markDirtyAndSave();
        this.updateQuantityDisplay(itemId, memberId, item);
    }

    decrementQuantity(itemId, memberId) {
        const item = this.items.find(item => item.id === itemId);
        if (!item) return;

        if (!item.quantity) item.quantity = {};
        if (item.quantity[memberId] > 0) {
            item.quantity[memberId]--;
            this.markDirtyAndSave();
            this.updateQuantityDisplay(itemId, memberId, item);
        }
    }

    clearQuantity(itemId, memberId) {
        const item = this.items.find(item => item.id === itemId);
        if (!item) return;

        if (!item.quantity) item.quantity = {};
        item.quantity[memberId] = 0;
        this.markDirtyAndSave();
        this.updateQuantityDisplay(itemId, memberId, item);
    }

    updateQuantityDisplay(itemId, memberId, item) {
        // Check if item should now be hidden
        if (!this.shouldItemBeVisible(item)) {
            const li = this.itemList.querySelector(`li[data-id="${itemId}"]`);
            if (li) li.remove();
            return;
        }

        const li = this.itemList.querySelector(`li[data-id="${itemId}"]`);
        if (li) {
            const memberCells = li.querySelectorAll('.member-cell');
            const cellIndex = this.getMemberCellIndex(memberId);
            const cell = memberCells[cellIndex];
            if (cell) {
                const qtyInput = cell.querySelector('.quantity-input');
                if (qtyInput) {
                    const qty = item.quantity[memberId] || 0;
                    qtyInput.value = qty;
                    qtyInput.classList.toggle('quantity-zero', qty === 0);
                }
            }
            this.updateItemCompletedClass(li, item);
        }
    }

    setQuantity(itemId, memberId, value) {
        const item = this.items.find(item => item.id === itemId);
        if (!item) return;

        if (!item.quantity) item.quantity = {};
        const numValue = parseInt(value) || 0;
        item.quantity[memberId] = Math.max(0, numValue);
        this.markDirtyAndSave();
        this.updateQuantityDisplay(itemId, memberId, item);
    }

    handleQuantityKey(event, itemId, memberId) {
        if (event.key === 'Enter') {
            event.target.blur();
        } else if (event.key === 'Escape') {
            event.target.value = event.target.dataset.original;
            event.target.blur();
            event.preventDefault();
        }
    }
    
    startEdit(id) {
        // Close any open comment editor
        if (this.editingCommentId !== null) {
            this.closeCommentEditor(this.editingCommentId);
        }
        
        // If already editing another item, close it first
        const previousEditId = this.editingId;
        if (previousEditId && previousEditId !== id) {
            this.editingId = null;
            this.updateSingleItem(previousEditId);
        }
        
        this.editingId = id;
        this.updateSingleItem(id);
    }
    
    saveEdit(id, newText) {
        const item = this.items.find(item => item.id === id);
        if (!item) {
            this.editingId = null;
            return;
        }
        
        const trimmed = newText.trim();
        if (!trimmed || trimmed === item.text) {
            this.editingId = null;
            this.updateSingleItem(id);
            return;
        }
        
        // Check for conflict with any item (active or archived)
        const conflict = this.items.find(i => i.id !== id && i.text.toLowerCase() === trimmed.toLowerCase());
        if (conflict) {
            const suggestedName = this.getUniqueItemCopyName(trimmed);
            const isArchived = conflict.archived;
            const archiveNote = isArchived ? ' (archived)' : '';
            
            const useSuggested = confirm(
                `An item named "${conflict.text}"${archiveNote} already exists.\n\n` +
                `Click OK to rename as "${suggestedName}" instead.`
            );
            
            if (useSuggested) {
                item.text = suggestedName;
                this.markDirtyAndSave();
            }
        } else {
            item.text = trimmed;
            this.markDirtyAndSave();
        }
        
        this.editingId = null;
        this.updateSingleItem(id);
    }
    
    cancelEdit() {
        const id = this.editingId;
        this.editingId = null;
        if (id) {
            this.updateSingleItem(id);
        }
    }
    
    // === TARGETED DOM UPDATES ===
    
    renderSingleItemHtml(item) {
        const gridColumns = this.getGridColumnsStyle();
        const isEditing = this.editingId === item.id;
        const completed = this.isFullyDone(item);

        let memberCellsHtml = '';
        this.members.forEach((member, index) => {
            const qty = item?.quantity?.[member.id] || 0;
            const isDone = item?.done?.[member.id] || false;

            memberCellsHtml += `
                <div class="member-cell">
                    <input
                        type="number"
                        class="quantity-input${qty === 0 ? ' quantity-zero' : ''}"
                        value="${qty}"
                        min="0"
                        data-original="${qty}"
                        data-item-id="${item.id}"
                        data-member-id="${member.id}"
                        aria-label="${this.escapeHtml(member.name)} quantity"
                    >
                    <button class="done-button ${isDone ? 'done-active' : ''}" type="button" title="Mark done" aria-label="Mark done for ${this.escapeHtml(member.name)}">✓</button>
                </div>
            `;
            if (index < this.members.length - 1) {
                memberCellsHtml += '<div></div>';
            }
        });

        const hasComment = !!item.comment;
        const isArchived = !!item.archived;

        if (isArchived) {
            return `
                <li class="archived-item" data-id="${item.id}" style="grid-template-columns: ${gridColumns}">
                    <span class="drag-handle disabled" aria-hidden="true">⋮⋮</span>
                    <span class="item-text">${this.escapeHtml(item.text)}</span>
                    ${memberCellsHtml}
                    <div></div>
                    <button class="restore-button" title="Restore" aria-label="Restore item">↩</button>
                    <button class="permanent-delete-button" title="Delete permanently" aria-label="Delete permanently">🗑</button>
                </li>
            `;
        }

        if (isEditing) {
            return `
                <li class="${completed ? 'completed' : ''} editing" data-id="${item.id}" style="grid-template-columns: ${gridColumns}">
                    <span class="drag-handle disabled" title="Finish editing to reorder" aria-label="Drag handle">⋮⋮</span>
                    <input type="text" class="edit-input" value="${this.escapeHtml(item.text)}" data-id="${item.id}">
                    ${memberCellsHtml}
                    <div></div>
                    <button class="comment-button ${hasComment ? 'has-comment' : ''}" title="Comment" aria-label="Add or edit comment">💬</button>
                    <button class="delete-button" title="Archive" aria-label="Archive item">📥</button>
                </li>
            `;
        }

        return `
            <li class="${completed ? 'completed' : ''}" data-id="${item.id}" style="grid-template-columns: ${gridColumns}">
                <span class="drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>
                <span class="item-text">${this.escapeHtml(item.text)}</span>
                ${memberCellsHtml}
                <div></div>
                <button class="comment-button ${hasComment ? 'has-comment' : ''}" title="Comment" aria-label="Add or edit comment">💬</button>
                <button class="delete-button" title="Archive" aria-label="Archive item">📥</button>
            </li>
        `;
    }
    
    updateSingleItem(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) return;
        
        const oldLi = this.itemList.querySelector(`li[data-id="${itemId}"]`);
        if (!oldLi) return;
        
        // Create new element from HTML
        const template = document.createElement('template');
        template.innerHTML = this.renderSingleItemHtml(item).trim();
        const newLi = template.content.firstChild;
        
        // Replace old element with new one
        oldLi.replaceWith(newLi);
        
        // Attach edit listener if in editing mode
        if (this.editingId === itemId) {
            const editInput = newLi.querySelector('.edit-input');
            if (editInput) {
                editInput.focus();
                editInput.select();
                editInput.addEventListener('blur', () => {
                    this.saveEdit(itemId, editInput.value);
                });
                editInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        this.saveEdit(itemId, editInput.value);
                    } else if (e.key === 'Escape') {
                        this.cancelEdit();
                    }
                });
            }
        }
    }

    // === DRAG & DROP ===

    onDragStart(e) {
        if (this.editingId !== null) {
            e.preventDefault();
            return;
        }
        if (!e.target.closest('.drag-handle')) {
            e.preventDefault();
            return;
        }

        const li = e.target.closest('li[data-id]');
        if (!li || !li.dataset.id) {
            e.preventDefault();
            return;
        }

        const id = li.dataset.id;
        this.draggedId = id;
        li.classList.add('dragging');

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
            try {
                e.dataTransfer.setDragImage(li, 20, 20);
            } catch (_) {}
        }
    }

    onDragOver(e) {
        if (this.draggedId === null) return;
        e.preventDefault();
        const { beforeId, topPx } = this.getDropPosition(e.clientY);
        this.dropBeforeId = beforeId;
        this.showDropIndicator(topPx);
    }

    onDrop(e) {
        if (this.draggedId === null) return;
        e.preventDefault();
        const draggedItem = this.items.find(item => item.id === this.draggedId);
        if (!draggedItem) return;

        const remaining = this.items.filter(item => item.id !== this.draggedId);
        if (this.dropBeforeId === null) {
            remaining.push(draggedItem);
        } else {
            const idx = remaining.findIndex(item => item.id === this.dropBeforeId);
            if (idx === -1) {
                remaining.push(draggedItem);
            } else {
                remaining.splice(idx, 0, draggedItem);
            }
        }

        this.items = remaining;
        this.saveState();
        this.draggedId = null;
        this.dropBeforeId = null;
        this.hideDropIndicator();
        this.render();
    }

    onDragEnd() {
        this.draggedId = null;
        this.dropBeforeId = null;
        this.hideDropIndicator();
        this.itemList.querySelectorAll('li.dragging').forEach(el => el.classList.remove('dragging'));
    }

    getDropPosition(clientY) {
        const listRect = this.itemList.getBoundingClientRect();
        const lis = Array.from(this.itemList.querySelectorAll('li[data-id]'))
            .filter(li => !li.classList.contains('dragging'));

        let beforeId = null;
        let topPx = this.itemList.scrollHeight;

        for (const li of lis) {
            const rect = li.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (clientY < midpoint) {
                beforeId = li.dataset.id;
                topPx = (rect.top - listRect.top) + this.itemList.scrollTop;
                return { beforeId, topPx };
            }
        }

        if (lis.length > 0) {
            const lastRect = lis[lis.length - 1].getBoundingClientRect();
            topPx = (lastRect.bottom - listRect.top) + this.itemList.scrollTop;
        } else {
            topPx = 0;
        }

        return { beforeId, topPx };
    }

    showDropIndicator(topPx) {
        if (!this.dropIndicator) return;
        this.dropIndicator.style.display = 'block';
        this.dropIndicator.style.top = `${Math.max(0, topPx)}px`;
    }

    hideDropIndicator() {
        if (!this.dropIndicator) return;
        this.dropIndicator.style.display = 'none';
    }
    
    // === RENDER ===

    render() {
        if (this.items.length === 0) {
            this.itemList.innerHTML = '<li class="empty-state">Your list is empty. Add an item to get started!</li>';
            this.hideDropIndicator();
            if (this.dropIndicator && !this.itemList.contains(this.dropIndicator)) {
                this.itemList.appendChild(this.dropIndicator);
            }
            return;
        }

        const visibleItems = this.getVisibleItems();

        this.itemList.innerHTML = visibleItems.map(item => {
            const isCommentOpen = this.editingCommentId === item.id;
            let html = this.renderSingleItemHtml(item);
            if (isCommentOpen) {
                html += this.renderCommentSection(item);
            }
            return html;
        }).join('');

        this.attachEditListeners();
        if (this.dropIndicator && !this.itemList.contains(this.dropIndicator)) {
            this.itemList.appendChild(this.dropIndicator);
        }
    }
    
    getVisibleItems() {
        return this.items.filter(item => this.shouldItemBeVisible(item));
    }

    getGridColumnsStyle() {
        let columns = '24px 200px';
        this.members.forEach((_, index) => {
            columns += ' 80px';
            if (index < this.members.length - 1) {
                columns += ' 20px';
            }
        });
        columns += ' 40px'; // spacer before buttons (doubled for better separation)
        columns += ' 30px'; // comment button
        columns += ' 40px'; // delete button
        return columns;
    }

    // === COMMENT METHODS ===

    renderCommentSection(item) {
        const commentText = item.comment || '';
        return `
            <div class="comment-section" data-comment-id="${item.id}">
                <textarea class="comment-textarea" placeholder="Add a comment...">${this.escapeHtml(commentText)}</textarea>
                <div class="comment-actions">
                    <button class="comment-save-btn">Save</button>
                    <button class="comment-cancel-btn">Cancel</button>
                </div>
            </div>
        `;
    }

    toggleComment(id) {
        // Close any other open comment editor
        if (this.editingCommentId !== null && this.editingCommentId !== id) {
            this.closeCommentEditor(this.editingCommentId);
        }

        const item = this.items.find(i => i.id === id);
        if (!item) return;

        if (this.editingCommentId === id) {
            this.closeCommentEditor(id);
        } else {
            this.openCommentEditor(id, item);
        }
    }

    openCommentEditor(id, item) {
        this.editingCommentId = id;
        const li = this.itemList.querySelector(`li[data-id="${id}"]`);
        if (!li) return;

        // Update button state
        const btn = li.querySelector('.comment-button');
        if (btn) btn.classList.add('comment-open');

        // Insert comment section after the li
        const commentHtml = this.renderCommentSection(item);
        li.insertAdjacentHTML('afterend', commentHtml);

        // Focus the textarea
        const textarea = li.nextElementSibling?.querySelector('.comment-textarea');
        if (textarea) textarea.focus();
    }

    closeCommentEditor(id) {
        this.editingCommentId = null;
        const li = this.itemList.querySelector(`li[data-id="${id}"]`);
        if (li) {
            const btn = li.querySelector('.comment-button');
            if (btn) btn.classList.remove('comment-open');
        }

        // Remove the comment section
        const commentSection = this.itemList.querySelector(`.comment-section[data-comment-id="${id}"]`);
        if (commentSection) {
            commentSection.remove();
        }
    }

    saveComment(id) {
        const commentSection = this.itemList.querySelector(`.comment-section[data-comment-id="${id}"]`);
        if (!commentSection) return;

        const textarea = commentSection.querySelector('.comment-textarea');
        const newComment = textarea ? textarea.value.trim() : '';

        const item = this.items.find(i => i.id === id);
        if (item) {
            item.comment = newComment;
            this.markDirtyAndSave();

            // Update the comment button to reflect if there's a comment
            const li = this.itemList.querySelector(`li[data-id="${id}"]`);
            if (li) {
                const btn = li.querySelector('.comment-button');
                if (btn) {
                    if (newComment) {
                        btn.classList.add('has-comment');
                    } else {
                        btn.classList.remove('has-comment');
                    }
                }
            }
        }

        this.closeCommentEditor(id);
    }

    cancelComment(id) {
        this.closeCommentEditor(id);
    }
    
    attachEditListeners() {
        const editInput = this.itemList.querySelector('.edit-input');
        if (editInput) {
            editInput.focus();
            editInput.select();
            editInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    editInput.blur();
                } else if (e.key === 'Escape') {
                    this.cancelEdit();
                }
            });
            editInput.addEventListener('blur', () => {
                if (this.editingId !== null) {
                    this.saveEdit(editInput.dataset.id, editInput.value);
                }
            });
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize auth manager first (listManager needs it for loadState)
authManager = new AuthManager();

// Initialize the app
const listManager = new ListManager();

// Member profile modal close handlers
document.getElementById('memberProfileModalClose')?.addEventListener('click', () => {
    document.getElementById('memberProfileModal').style.display = 'none';
});
document.getElementById('memberProfileModal')?.querySelector('.modal-backdrop')?.addEventListener('click', () => {
    document.getElementById('memberProfileModal').style.display = 'none';
});

// Listen for auth state changes
authManager.subscribe(async (event, user) => {
    if (event === 'SIGNED_IN' && user) {
        listManager.reloadForUser();
        listManager.enableSync();
        // Background sync - don't await, let UI remain responsive
        listManager.backgroundSyncOnSignIn().catch(err => {
            SupabaseLog.logError('Background sync', err.message);
        });
    } else if (event === 'SIGNED_OUT') {
        listManager.reloadForUser();
        listManager.disableSync();
    }
});

// If user is already signed in (session restored from localStorage), trigger background sync
if (authManager.isAuthenticated()) {
    listManager.enableSync();
    listManager.backgroundSyncOnSignIn().catch(err => {
        SupabaseLog.logError('Background sync', err.message);
    });
}

// Warn about unsaved changes and flush pending saves before page unload
window.addEventListener('beforeunload', (e) => {
    if (listManager.listEditor) {
        if (listManager.listEditor.hasPendingChanges()) {
            // Show browser's native "unsaved changes" warning
            e.preventDefault();
            e.returnValue = '';
        }
        // Always flush pending saves
        if (listManager.listEditor.saveStateDebounced) {
            listManager.listEditor.saveStateDebounced.flush();
        }
    }
});
