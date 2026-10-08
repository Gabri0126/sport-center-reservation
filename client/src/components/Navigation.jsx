import 'bootstrap-icons/font/bootstrap-icons.css';
import { Navbar, Nav, Badge } from 'react-bootstrap';
import { NavLink } from 'react-router';
import { LoginButton, LogoutButton } from './Auth.jsx';

function Navigation(props) {
  // Purely presentational: the actual auth state lives in App.jsx and is
  // passed down as props, so this component never manages its own state and
  // just decides what to render based on it. Always visible on every route,
  // as required, so there's always a way to get back home or log out.
  return (
    <Navbar bg="dark" variant="dark" expand="md" className="mb-3 px-3">
      <Navbar.Brand>
        <i className="bi bi-trophy mx-2" />
        Sport Center
      </Navbar.Brand>
      <Nav className="me-auto">
        <NavLink className="nav-link" to="/">Home</NavLink>
        {props.loggedIn && <NavLink className="nav-link" to="/book">Book a facility</NavLink>}
        {props.loggedIn && <NavLink className="nav-link" to="/reservations">My reservations</NavLink>}
      </Nav>
      <Nav className="align-items-center">
        {props.loggedIn && props.user &&
          <Navbar.Text className="mx-3">
            {props.user.name} — score: <Badge bg={props.user.score < 0 ? 'danger' : 'secondary'}>{props.user.score}</Badge>
            {props.loggedInTotp && <Badge bg="success" className="ms-2">2FA</Badge>}
          </Navbar.Text>
        }
        {props.loggedIn ? <LogoutButton logout={props.logout} name={props.user?.name} /> : <LoginButton />}
      </Nav>
    </Navbar>
  );
}

export { Navigation };

// Alice in Wonderland: "Off with her head!"
