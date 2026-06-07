import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"

// only enable Google when configured, so local/CI runs without OAuth secrets
const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
const DUMMY_HASH = "$2b$10$E8gu9h1g2PhgJpgBLSPRYOGW1q7Xl3Cq.VMwDkH1KbCCJTRjnfkZ."

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // host header is the frontend domain behind the vercel rewrite; trust it for correct callback/cookie urls
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = (credentials?.username as string)?.toLowerCase().trim()
        const password = credentials?.password as string
        if (!username || !password) return null
        // username stored in the `email` column (legacy field reused as unique id)
        const user = await prisma.user.findUnique({ where: { email: username } })
        const ok = await bcrypt.compare(password, user?.password ?? DUMMY_HASH)
        if (!ok || !user?.password) return null
        return { id: user.id, name: user.name, email: user.email }
      },
    }),
    ...(googleEnabled
      ? [Google({
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        })]
      : []),
  ],
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7,
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      return session
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id
      }
      return token
    },
  },
})
