/**
 * Root component (HELIX-175): the auth provider + the route map. `main.tsx` mounts this
 * inside a `BrowserRouter`. Authenticated routes render inside the {@link Layout} shell
 * behind {@link RequireAuth}; each placeholder is replaced by its real screen in
 * HELIX-176…179.
 */
import { type ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from '../auth/auth-context';
import { Layout } from './layout';
import { Placeholder } from './pages/placeholder';
import { SignIn } from './pages/sign-in';

export function App(): ReactElement {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Placeholder title="Run dashboard" note="Request submission + the live run dashboard land in HELIX-177." />} />
          <Route path="/approvals" element={<Placeholder title="Approval inbox" note="The approval inbox lands in HELIX-178." />} />
          <Route path="/integrations" element={<Placeholder title="GitHub integration" note="The connect wizard lands in HELIX-179." />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

export default App;
