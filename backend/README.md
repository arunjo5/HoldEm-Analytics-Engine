# Hold'Em Odds Calculator with Authentication

A poker odds calculator with Google Sign-In authentication and search history functionality.

## Features

- **Poker Odds Calculation**: Calculate winning probabilities for Texas Hold'em hands
- **Google Authentication**: Sign in with your Google account
- **Search History**: Save and replay your previous calculations
- **Responsive Design**: Works on desktop and mobile devices
- **Dark/Light Mode**: Toggle between color schemes

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Create a `.env.local` file in the root directory with the following variables:

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

### 3. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Go to Credentials → Create Credentials → OAuth 2.0 Client IDs
5. Set the authorized redirect URI to: `http://localhost:3000/api/auth/callback/google`
6. Copy the Client ID and Client Secret to your `.env.local` file

### 4. Database Setup

1. Install PostgreSQL on your system
2. Create a new database: `holdem_odds_db`
3. Update the `DATABASE_URL` in your `.env.local` file
4. Run the database migrations:

```bash
npx prisma migrate dev --name init
```

### 5. Generate Prisma Client

```bash
npx prisma generate
```

### 6. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. **Sign In**: Click "Sign in with Google" to authenticate
2. **Set Up Game**: Use the table interface to set player hands and community cards
3. **Calculate Odds**: View real-time probability calculations
4. **Save Searches**: Click "Save Current Search" to store your calculations
5. **View History**: Access your saved searches in the right sidebar
6. **Replay Searches**: Click the replay button on any saved search to restore the game state

## Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   └── auth/          # NextAuth configuration
│   │   └── searches/      # Search management API
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Main page
│   ├── providers.tsx      # Context providers
│   └── theme.ts           # Chakra UI theme
├── components/             # React components
│   ├── auth/              # Authentication components
│   ├── search/            # Search management components
│   ├── CardSelector.tsx   # Card selection interface
│   ├── Header.tsx         # App header with auth
│   ├── OddsDisplay.tsx    # Odds display
│   ├── PlayingCard.tsx    # Individual card component
│   ├── Table.tsx          # Poker table interface
│   └── ColorModeToggle.tsx # Theme toggle
├── contexts/               # React contexts
│   └── AuthContext.tsx    # Authentication context
├── lib/                    # Utility libraries
│   ├── odds.ts            # Odds calculation logic
│   └── prisma.ts          # Database client
└── types/                  # TypeScript type definitions
    └── next-auth.d.ts     # NextAuth type extensions
```

## Technologies Used

- **Next.js 14** - React framework with App Router
- **NextAuth.js** - Authentication library
- **Prisma** - Database ORM
- **PostgreSQL** - Database
- **Chakra UI** - Component library
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first CSS

## API Endpoints

- `POST /api/searches` - Create a new search
- `GET /api/searches` - Get user's search history
- `DELETE /api/searches/[id]` - Delete a specific search

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License
