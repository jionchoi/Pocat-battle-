import 'express';

/**
 * What `authenticate` puts on the request.
 *
 * Optional on the type because it is absent on public routes, which is why services take
 * the id as an argument rather than reaching for the request themselves — a service that
 * read `req.user` would compile fine on a route where nobody had authenticated.
 */
declare module 'express' {
  interface Request {
    user?: {
      /** The Supabase `auth.users.id`, straight from the verified token's `sub`. */
      id: string;
      email: string;
    };
  }
}
