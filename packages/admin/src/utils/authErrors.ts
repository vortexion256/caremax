/**
 * Converts Firebase authentication error codes to user-friendly messages
 */
export function getAuthErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'An unexpected error occurred';
  }

  const errorMessage = error.message.toLowerCase();
  const errorCode = error.message.match(/auth\/([^)]+)/)?.[1];

  // Handle Firebase error codes
  switch (errorCode) {
    case 'invalid-credential':
    case 'wrong-password':
    case 'user-not-found':
      return 'Invalid email or password. Please check your credentials and try again.';
    
    case 'email-already-in-use':
      return 'This email is already registered. Please sign in instead.';
    
    case 'weak-password':
      return 'Password is too weak. Please use at least 6 characters.';
    
    case 'invalid-email':
      return 'Invalid email address. Please check and try again.';
    
    case 'user-disabled':
      return 'This account has been disabled. Please contact support.';
    
    case 'too-many-requests':
      return 'Too many failed attempts. Please try again later.';
    
    case 'network-request-failed':
      return 'Network error. Please check your internet connection and try again.';
    
    case 'popup-closed-by-user':
      return 'Sign-in popup was closed. Please try again.';
    
    case 'popup-blocked':
      return 'Popup was blocked. Please allow popups for this site and try again.';
    
    case 'cancelled-popup-request':
      return 'Sign-in was cancelled. Please try again.';
    
    default:
      // Check for common error patterns in the message
      if (errorMessage.includes('invalid-credential') || errorMessage.includes('wrong-password')) {
        return 'Invalid email or password. Please check your credentials and try again.';
      }
      if (errorMessage.includes('email-already-in-use')) {
        return 'This email is already registered. Please sign in instead.';
      }
      if (errorMessage.includes('network')) {
        return 'Network error. Please check your internet connection and try again.';
      }
      if (errorMessage.includes('popup')) {
        return 'Sign-in popup was closed or blocked. Please try again.';
      }
      
      // Return a generic message for unknown errors
      return 'Authentication failed. Please try again.';
  }
}
