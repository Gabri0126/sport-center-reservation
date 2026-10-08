import { Container, Button } from 'react-bootstrap';
import { Outlet, Link } from 'react-router';
import { Navigation } from './Navigation.jsx';

function GenericLayout(props) {
  return (
    <>
      <Navigation loggedIn={props.loggedIn} user={props.user} loggedInTotp={props.loggedInTotp} logout={props.logout} />
      <Container>
        {/* Outlet renders whichever nested route is currently active (Home,
            BookingForm, ReservationsList, ...): the navbar above never
            re-renders when only the page content changes. */}
        <Outlet />
      </Container>
    </>
  );
}

function NotFoundLayout() {
  return (
    <Container className="text-center mt-5">
      <h2>This route is not valid!</h2>
      {/* Always give a clear way back to a known page instead of leaving
          the user stuck, per usability requirements. */}
      <Link to="/">
        <Button variant="primary">Go back to the main page</Button>
      </Link>
    </Container>
  );
}

export { GenericLayout, NotFoundLayout };

// Alice in Wonderland: "Would you tell me, please, which way I ought to go from here?"
