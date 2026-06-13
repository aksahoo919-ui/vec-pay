# Firestore Security Rules Setup Guide

## Quick Setup

The `firestore.rules` file has been created with the appropriate security rules for your VEC Payment System.

## How to Deploy Rules to Firebase

### Option 1: Using Firebase Console (Easiest)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Navigate to **Firestore Database** in the left sidebar
4. Click on the **Rules** tab
5. Copy the contents of `firestore.rules` file
6. Paste it into the rules editor
7. Click **Publish** to deploy the rules

### Option 2: Using Firebase CLI

1. Install Firebase CLI (if not already installed):
   ```bash
   npm install -g firebase-tools
   ```

2. Login to Firebase:
   ```bash
   firebase login
   ```

3. Initialize Firebase in your project (if not already done):
   ```bash
   firebase init firestore
   ```

4. Deploy the rules:
   ```bash
   firebase deploy --only firestore:rules
   ```

## Rules Overview

The security rules provide:

### Cities Collection
- ✅ **Public Read**: Anyone can read cities (needed for student form dropdown)
- ✅ **Admin Write**: Only authenticated admins can create, update, or delete cities

### Schools Collection
- ✅ **Public Read**: Anyone can read schools (needed for student form dropdown)
- ✅ **Admin Write**: Only authenticated admins can create, update, or delete schools

### Payments Collection
- ✅ **Public Create**: Anyone can create payment records (needed for payment processing)
- ✅ **Admin Read**: Only authenticated admins can read payment records
- ❌ **No Updates/Deletes**: Payments are immutable (cannot be modified or deleted)

## Admin Emails

The current admin emails configured in the rules are:
- `aksahoo.919@gmail.com`
- `abhaynitaidas.bavs@gmail.com`

To add more admins, update the `isAdmin()` function in `firestore.rules` and redeploy.

## Testing the Rules

After deploying, test by:
1. Logging in as an admin and trying to add/edit/delete cities and schools
2. Testing payment creation from the student form
3. Verifying that non-admin users cannot modify cities or schools

## Troubleshooting

If you still get permission errors:
1. Make sure you're logged in with one of the admin emails
2. Check that the rules have been published (wait a few seconds after publishing)
3. Clear browser cache and try again
4. Check the browser console for detailed error messages

