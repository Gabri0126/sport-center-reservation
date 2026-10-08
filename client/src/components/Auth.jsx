import { useState } from 'react';
import { Form, Button, Alert, Col, Row } from 'react-bootstrap';
import { useNavigate } from 'react-router';
import API from '../API.js';

function LoginForm(props) {
  // Pre-filled with a valid demo account rather than empty fields: makes it
  // faster to test the app without having to remember/retype credentials.
  const [username, setUsername] = useState('alice@sport.it');
  const [password, setPassword] = useState('pwd');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();
    setErrorMessage('');

    if (!username) {
      setErrorMessage('Username cannot be empty');
    } else if (!password) {
      setErrorMessage('Password cannot be empty');
    } else {
      // props.login (App.jsx's handleLogin) rejects on failure rather than
      // handling the error itself; the error is caught here, close to the
      // UI that needs to display it.
      props.login({ username, password })
        .catch((err) => setErrorMessage(err.error || 'Login failed'));
    }
  };

  return (
    <Row className="justify-content-center mt-4">
      <Col xs={12} md={5}>
        <h1 className="pb-3">Login</h1>
        <Form onSubmit={handleSubmit}>
          {errorMessage ? <Alert dismissible onClose={() => setErrorMessage('')} variant="danger">{errorMessage}</Alert> : null}
          <Form.Group className="mb-3">
            <Form.Label>Email</Form.Label>
            <Form.Control
              type="email"
              value={username}
              onChange={(ev) => setUsername(ev.target.value)}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Password</Form.Label>
            <Form.Control
              type="password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
            />
          </Form.Group>
          <Button type="submit">Login</Button>
        </Form>
        <p className="text-muted mt-3">
          Demo users (password <code>pwd</code>): alice, bob, carol, dave @sport.it
        </p>
      </Col>
    </Row>
  );
}

function TotpForm(props) {
  const [totpCode, setTotpCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const navigate = useNavigate();

  const doTotpVerify = () => {
    API.totpVerify(totpCode)
      .then((user) => {
        setErrorMessage('');
        props.totpSuccessful(user);
        navigate('/');
      })
      .catch((err) => {
        // Two distinct failure cases, shown with different messages: a
        // "Not authenticated" response means the session itself expired
        // (e.g. the server restarted) before the code was checked at all,
        // while any other error means the session is still valid but the
        // 6-digit code was wrong.
        if (err && err.error === 'Not authenticated') {
          setErrorMessage('Your session has expired, you will be redirected to the login page');
          setTimeout(() => props.setLoggedIn(false), 2000);
        } else {
          setErrorMessage('Wrong code, please try again');
        }
      });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setErrorMessage('');
    if (totpCode === '' || totpCode.length !== 6) {
      setErrorMessage('Invalid content in form: the code must be 6 digits');
    } else {
      doTotpVerify();
    }
  };

  return (
    <Row className="justify-content-center mt-4">
      <Col xs={12} md={5}>
        <h2>Second Factor Authentication</h2>
        <h6 className="text-muted">
          Please enter the code from your authenticator app. Completing this step
          also resets your score to 0 if it is currently negative.
        </h6>
        <Form onSubmit={handleSubmit}>
          {errorMessage ? <Alert variant="danger" dismissible onClose={() => setErrorMessage('')}>{errorMessage}</Alert> : ''}
          <Form.Group controlId="totpCode" className="mb-3">
            <Form.Label>Code</Form.Label>
            <Form.Control type="text" value={totpCode} onChange={ev => setTotpCode(ev.target.value)} />
          </Form.Group>
          <Button className="my-2" type="submit">Validate</Button>
          <Button className="my-2 mx-2" variant="outline-secondary" onClick={() => navigate('/')}>Skip</Button>
        </Form>
      </Col>
    </Row>
  );
}

function LogoutButton(props) {
  return <Button variant="outline-light" onClick={props.logout}>Logout ({props.name})</Button>;
}

function LoginButton() {
  const navigate = useNavigate();
  return <Button variant="outline-light" onClick={() => navigate('/login')}>Login</Button>;
}

export { LoginForm, TotpForm, LogoutButton, LoginButton };

// Alice in Wonderland: "Who are you?" said the Caterpillar.
