import { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Spinner, Alert } from 'react-bootstrap';
import API from '../API.js';

const FACILITY_LABELS = {
  tennis: 'Tennis court',
  basketball: 'Basketball court',
  volleyball: 'Volleyball court',
  soccer: 'Soccer field',
  tabletennis: 'Table tennis table',
  cycling: 'Cycling track',
};

const EQUIPMENT_LABELS = {
  tennis_racket: 'Tennis racket',
  tennis_ball: 'Tennis ball',
  towel: 'Towel',
  basketball: 'Basketball',
  cone: 'Cone',
  volleyball: 'Volleyball',
  knee_pads: 'Pair of knee pads',
  soccer_ball: 'Soccer ball',
  soccer_shoes: 'Pair of soccer shoes',
  goalkeeper_gloves: 'Pair of goalkeeper gloves',
  tabletennis_racket: 'Table tennis racket',
  tabletennis_ball: 'Table tennis ball',
  bicycle: 'Bicycle',
  helmet: 'Helmet',
  repair_kit: 'Repair kit',
};

function Home() {
  const [facilities, setFacilities] = useState(null);
  const [equipment, setEquipment] = useState(null);
  const [requirements, setRequirements] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // The three calls are independent (none depends on another's result),
    // so they're fired together with Promise.all instead of sequentially:
    // the page waits for the slowest one, not the sum of all three.
    Promise.all([API.getFacilities(), API.getEquipment(), API.getFacilityRequirements()])
      .then(([f, e, r]) => { setFacilities(f); setEquipment(e); setRequirements(r); })
      .catch(() => setError('Cannot load the current availability from the server'));
  }, []);

  // Quick lookup equipmentType -> { type, available, total }, used to join the
  // live stock numbers onto each facility type's own requirement list below.
  const equipmentByType = {};
  if (equipment) equipment.forEach(e => { equipmentByType[e.type] = e; });

  return (
    <>
      <h1 className="mb-3">Welcome to the Sport Center</h1>
      <p className="text-muted">
        Here you can see, at a glance, how many facilities are available for
        each sport, and which equipment is required to book them. Log in to
        book a facility.
      </p>

      {error && <Alert variant="danger">{error}</Alert>}

      <Row className="mb-4">
        <Col>
          <h3>Facilities</h3>
          {!facilities ? <Spinner /> : (
            <Row xs={2} md={3} lg={6} className="g-3">
              {facilities.map(f => (
                <Col key={f.type}>
                  <Card className="facility-card text-center">
                    <Card.Body>
                      <Card.Title className="fs-6">{FACILITY_LABELS[f.type] || f.type}</Card.Title>
                      <Card.Text className="fs-4 scoreboard-figure">
                        {f.available}<span className="scoreboard-total"> / {f.total}</span>
                      </Card.Text>
                      <Card.Text className="text-muted small">available</Card.Text>
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>
          )}
        </Col>
      </Row>

      <Row>
        <Col>
          <h3 className="mb-3">Equipment by sport</h3>
          {(!facilities || !equipment || !requirements) ? <Spinner /> : (
            facilities.map(f => (
              <div key={f.type} className="mb-4">
                <h5>{FACILITY_LABELS[f.type] || f.type}</h5>
                <Table striped bordered hover responsive size="sm">
                  <thead>
                    <tr><th>Equipment</th><th>Requirement</th><th>Available</th><th>Total</th></tr>
                  </thead>
                  <tbody>
                    {(requirements[f.type] || []).map(req => {
                      const eq = equipmentByType[req.equipmentType] || { available: 0, total: 0 };
                      return (
                        <tr key={req.equipmentType}>
                          <td>{EQUIPMENT_LABELS[req.equipmentType] || req.equipmentType}</td>
                          <td className="text-muted">
                            {req.mandatory ? `mandatory, min. ${req.minQuantity}` : 'optional'}
                          </td>
                          <td className="scoreboard-figure">{eq.available}</td>
                          <td className="text-muted">{eq.total}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            ))
          )}
        </Col>
      </Row>
    </>
  );
}

export { Home, FACILITY_LABELS, EQUIPMENT_LABELS };

// Alice in Wonderland: "Curiouser and curiouser!"
