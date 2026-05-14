import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/session'

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isLoginPage = pathname === '/login'
  const isApiAuth = pathname.startsWith('/api/auth')
  const isStatic = pathname.startsWith('/_next') || pathname === '/favicon.ico'

  if (isStatic || isApiAuth) return NextResponse.next()

  const token = req.cookies.get('wasabi_session')?.value
  const session = token ? await verifySession(token) : null
  const isLoggedIn = !!session

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
