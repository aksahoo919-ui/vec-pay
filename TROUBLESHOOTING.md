# Troubleshooting Permission Errors

## Step-by-Step Debugging Guide

### Step 1: Verify You're Logged In

1. Open your browser's Developer Console (F12)
2. Try to add a school or city
3. Check the console for:
   - `Current user: [your-email]`
   - `Is admin? true/false`

**If you see "Current user: null" or "Is admin? false":**
- You're not logged in or not logged in as an admin
- Click "Admin Login" and sign in with Google using one of the admin emails

### Step 2: Test with Permissive Rules

Use the temporary test rules to verify authentication is working:

1. Copy the contents of `firestore.rules.test`
2. Go to Firebase Console → Firestore Database → Rules
3. Paste and click **Publish**
4. Try adding a school or city again

**If this works:**
- Authentication is working, but the admin email check in rules is failing
- Proceed to Step 3

**If this still fails:**
- There's an authentication issue
- Check that Firebase Auth is properly configured
- Verify your `.env` file has correct Firebase config values

### Step 3: Check Email in Auth Token

The issue might be how the email is stored in the auth token. Try this:

1. In your browser console, run:
   ```javascript
   // After logging in, check the auth token
   import { getAuth } from 'firebase/auth';
   const auth = getAuth();
   console.log('User:', auth.currentUser);
   console.log('Email:', auth.currentUser?.email);
   ```

2. Verify the email matches exactly (case-sensitive):
   - `aksahoo.919@gmail.com`
   - `abhaynitaidas.bavs@gmail.com`

### Step 4: Alternative Rules (Collection-Based)

If email checking doesn't work, use the collection-based approach:

1. In Firebase Console, create a collection called `admins`
2. Add a document with ID = your user's UID (found in auth.currentUser.uid)
3. The document can be empty `{}` or have `{ email: "your@email.com" }`
4. Use `firestore.rules.alternative` instead of `firestore.rules`

### Step 5: Verify Rules Are Deployed

1. Go to Firebase Console → Firestore Database → Rules
2. Check the "Last published" timestamp
3. Make sure it's recent (within the last few minutes)
4. Rules can take 10-60 seconds to propagate

### Step 6: Check Firestore Console for Errors

1. Go to Firebase Console → Firestore Database → Usage tab
2. Look for any permission denied errors
3. Check the Rules tab for syntax errors (should be highlighted in red)

## Common Issues and Solutions

### Issue: "Missing or insufficient permissions"

**Possible causes:**
1. Not logged in → Log in as admin
2. Rules not deployed → Deploy rules again
3. Email mismatch → Check exact email spelling
4. Rules syntax error → Check Firebase Console for errors

### Issue: Works with test rules but not with admin rules

**Solution:**
- The email check in rules is failing
- Try using `firestore.rules.debug` first
- Then switch to collection-based admin management (`firestore.rules.alternative`)

### Issue: Rules deployed but still getting errors

**Solution:**
1. Wait 30-60 seconds for propagation
2. Clear browser cache
3. Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
4. Try in incognito/private window

## Quick Fix: Use Test Rules Temporarily

If you need to work immediately:

1. Deploy `firestore.rules.test` (allows any authenticated user)
2. This is NOT secure for production
3. Switch back to proper rules once debugging is complete

## Still Having Issues?

1. Check browser console for detailed error messages
2. Check Firebase Console → Firestore → Rules for syntax errors
3. Verify Firebase project ID matches in your `.env` file
4. Ensure you're using the correct Firebase project

