# Setup Guide for Hold'Em Odds Calculator Authentication

## Prerequisites

- Node.js 18+ installed
- PostgreSQL database
- Google Cloud Console account

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Create a `.env.local` file in the root directory:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/holdem_odds_db"

# NextAuth
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

**Important Notes:**
- Replace `username`, `password`, and `holdem_odds_db` with your actual PostgreSQL credentials
- Generate a random string for `NEXTAUTH_SECRET` (you can use `openssl rand -base64 32`)
- Set `NEXTAUTH_URL` to your actual domain in production

### 3. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Go to **APIs & Services** → **Credentials**
5. Click **Create Credentials** → **OAuth 2.0 Client IDs**
6. Set **Application type** to "Web application"
7. Add **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google` (for development)
   - `https://yourdomain.com/api/auth/callback/google` (for production)
8. Copy the **Client ID** and **Client Secret** to your `.env.local` file

### 4. Database Setup

1. Install PostgreSQL on your system
2. Create a new database:
   ```sql
   CREATE DATABASE holdem_odds_db;
   ```
3. Update the `DATABASE_URL` in your `.env.local` file with your actual credentials
4. Run the database migrations:
   ```bash
   npx prisma migrate dev --name init
   ```

### 5. Generate Prisma Client

```bash
npx prisma generate
```

### 6. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Testing the Authentication

1. You should see a "Sign in with Google" button in the top-right corner
2. Click it to test the Google OAuth flow
3. After signing in, you should see your user avatar and name
4. The search management sidebar should now be accessible

## Troubleshooting

### Common Issues

1. **"Invalid redirect URI" error**: Make sure your Google OAuth redirect URI matches exactly
2. **Database connection error**: Verify your PostgreSQL credentials and that the database exists
3. **"Prisma client not initialized"**: Run `npx prisma generate` after setting up the database
4. **Build errors**: Make sure all environment variables are set correctly

### Environment Variable Checklist

- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `NEXTAUTH_SECRET` - Random secret string
- [ ] `NEXTAUTH_URL` - Your application URL
- [ ] `GOOGLE_CLIENT_ID` - From Google Cloud Console
- [ ] `GOOGLE_CLIENT_SECRET` - From Google Cloud Console

## Production Deployment

1. Set up a production PostgreSQL database
2. Update environment variables with production values
3. Set `NEXTAUTH_URL` to your production domain
4. Update Google OAuth redirect URIs to include your production domain
5. Use a strong, unique `NEXTAUTH_SECRET`
6. Consider using environment variable management services (Vercel, Netlify, etc.)

## Security Notes

- Never commit `.env.local` to version control
- Use strong, unique secrets for production
- Regularly rotate your OAuth credentials
- Monitor your application logs for suspicious activity
- Consider implementing rate limiting for API endpoints
