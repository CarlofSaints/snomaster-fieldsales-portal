# Plan: Reset Password + Forgot Password Feature

## Immediate: Get Carl Back In
The seed route blocks when users exist. Need a force-reset endpoint.

### 1. Create `app/api/admin-reset/route.ts`
- POST with `{ secret: "snomaster-seed-2026", email, newPassword }`
- Finds user by email, bcrypt-hashes new password, saves
- This is the permanent admin-level password reset (not temporary)

## Forgot Password Flow

### 2. Add reset token fields to `lib/userData.ts`
- Add `resetToken?: string` and `resetTokenExpiry?: string` to User interface

### 3. Create `app/api/forgot-password/route.ts`
- POST with `{ email }`
- Looks up user, generates crypto.randomUUID() token, stores on user with 1-hour expiry
- Sends email via Resend with link: `https://snomaster-fieldsales-portal.vercel.app/reset-password?token=xxx`
- Always returns success (don't reveal if email exists)

### 4. Create `app/api/reset-password/route.ts`
- POST with `{ token, password }`
- Finds user with matching token + valid expiry
- Hashes new password, clears token fields, saves

### 5. Create `app/reset-password/page.tsx`
- Token from URL query param
- New password + confirm password fields
- Submit to `/api/reset-password`
- Success → redirect to login

### 6. Update `app/login/page.tsx`
- Add "Forgot My Password?" link below sign-in button
- Clicking shows inline email input + "Send Reset Link" button
- Calls `/api/forgot-password`
- Shows success message: "If that email exists, a reset link has been sent"

## Deploy & Reset
- Push all changes
- Call `/api/admin-reset` with Carl's email + new password
- Verify login works
