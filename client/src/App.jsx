import './App.css';

import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router';

import { GenericLayout, NotFoundLayout } from './components/Layout.jsx';
import { Home } from './components/Home.jsx';
import { LoginForm, TotpForm } from './components/Auth.jsx';
import { BookingForm } from './components/BookingForm.jsx';
import { ReservationsList } from './components/ReservationsList.jsx';
import API from './API.js';

function App() {
  // Keeps track of whether the user is currently logged-in (password verified).
  const [loggedIn, setLoggedIn] = useState(false);
  // Contains the user's info (id, username, name, score, canDoTotp, isTotp).
  const [user, setUser] = useState(null);
  // True only after the second factor (TOTP) has been successfully verified.
  const [loggedInTotp, setLoggedInTotp] = useState(false);

  // On first load, check whether a session cookie is already valid.
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const u = await API.getUserInfo();
        setLoggedIn(true);
        setUser(u);
        if (u.isTotp) setLoggedInTotp(true);
      } catch {
        // no need to do anything: the user is simply not yet authenticated
      }
    };
    checkAuth();
  }, []);

  const handleLogin = async (credentials) => {
    const u = await API.logIn(credentials); // throws on failure: handled in LoginForm
    setUser(u);
    setLoggedIn(true);
  };

  // Re-fetches the current user's info from the server (used after an
  // operation that changes the user's score, e.g. deleting a reservation).
  // Best-effort only: the triggering operation (e.g. the delete) already
  // gave its own success/error feedback, so a failure here just means the
  // score badge stays at its last known value until the next successful
  // refresh (e.g. navigating to another page).
  const refreshUser = async () => {
    try {
      const u = await API.getUserInfo();
      setUser(u);
    } catch {
      // intentionally silent: see comment above
    }
  };

  const handleLogout = async () => {
    try {
      await API.logOut();
    } catch {
      // Even if the server-side logout call fails (e.g. server unreachable),
      // we still clear the local session state below so the user is not
      // stuck in a "logged in" UI they can no longer use.
    } finally {
      setLoggedIn(false);
      setLoggedInTotp(false);
      setUser(null);
    }
  };

  return (
    <Routes>
      <Route path="/" element={
        <GenericLayout loggedIn={loggedIn} user={user} loggedInTotp={loggedInTotp} logout={handleLogout} />
      }>
        <Route index element={<Home />} />

        <Route path="book" element={
          loggedIn ? <BookingForm user={user} /> : <Navigate replace to="/login" />
        } />

        <Route path="reservations" element={
          loggedIn ? <ReservationsList user={user} refreshUser={refreshUser} /> : <Navigate replace to="/login" />
        } />

        <Route path="login" element={
          <LoginWithTotp
            loggedIn={loggedIn} loggedInTotp={loggedInTotp} user={user}
            login={handleLogin} setLoggedIn={setLoggedIn} setLoggedInTotp={setLoggedInTotp} setUser={setUser}
          />
        } />

        <Route path="*" element={<NotFoundLayout />} />
      </Route>
    </Routes>
  );
}

// Decides, based on the current auth state, whether to show the login form,
// the TOTP form, or redirect to the home page (same pattern used in the labs).
function LoginWithTotp(props) {
  if (!props.loggedIn) {
    return <LoginForm login={props.login} />;
  }
  if (props.user.canDoTotp && !props.loggedInTotp) {
    return <TotpForm
      totpSuccessful={(u) => { props.setUser(u); props.setLoggedInTotp(true); }}
      setLoggedIn={props.setLoggedIn}
    />;
  }
  return <Navigate replace to="/" />;
}

export default App;

// Alice in Wonderland: "Why, sometimes I've believed as many as six impossible things before breakfast."
