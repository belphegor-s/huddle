import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('signin', 'routes/signin.tsx'),
  route('signout', 'routes/signout.tsx'),
  route('new', 'routes/new-workspace.tsx'),
  route('join/:token', 'routes/join.tsx'),

  route('w/:slug', 'routes/workspace.tsx', [
    index('routes/workspace-home.tsx'),
    route('c/:ref', 'routes/channel.tsx'),
    route('search', 'routes/search.tsx'),
    route('people', 'routes/members.tsx'),
    route('you', 'routes/profile.tsx'),
    route('settings', 'routes/settings.tsx'),
  ]),

  route('specimen', 'routes/specimen.tsx'),
] satisfies RouteConfig;
