import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Usuário', type: 'text' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null

        const adminUsername = process.env.ADMIN_USERNAME
        const adminHash = process.env.ADMIN_PASSWORD_HASH

        if (!adminUsername || !adminHash) return null

        if (credentials.username !== adminUsername) return null

        const valid = await bcrypt.compare(
          credentials.password as string,
          adminHash
        )

        if (!valid) return null

        return { id: '1', name: 'Admin', email: 'admin@wasabi.com' }
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 horas
  },
})
