import { useEffect, useState } from 'react';
import { Row, Col, Form, Button, Alert, Card } from 'react-bootstrap';
import { useNavigate } from 'react-router';
import API from '../API.js';
import { FACILITY_LABELS, EQUIPMENT_LABELS } from './Home.jsx';

function BookingForm(props) {
  const { user } = props;
  const restricted = user.score < 0; // negative score: minimum mandatory equipment only
  const navigate = useNavigate();

  const [requirements, setRequirements] = useState(null); // { type: [{equipmentType,minQuantity,mandatory}] }
  const [facilityTypes, setFacilityTypes] = useState([]);
  const [selectedType, setSelectedType] = useState('');
  const [mode, setMode] = useState('auto'); // 'auto' | 'direct'
  const [availableIds, setAvailableIds] = useState([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState('');
  const [quantities, setQuantities] = useState({}); // equipmentType -> quantity
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { variant, text }

  // Load facility requirements once. This is the one legitimate use case for
  // useEffect here: fetching data from the server on mount.
  useEffect(() => {
    API.getFacilityRequirements()
      .then(reqs => {
        setRequirements(reqs);
        const types = Object.keys(reqs);
        setFacilityTypes(types);
        if (types.length > 0) {
          setSelectedType(types[0]);
          setQuantities(defaultQuantitiesFor(types[0], reqs));
        }
      })
      .catch(() => setResult({ variant: 'danger', text: 'Cannot load facility requirements' }));
  }, []);

  // Builds the default equipment quantities (mandatory minimum, 0 for
  // optional) for a given facility type.
  const defaultQuantitiesFor = (type, reqs) => {
    const initial = {};
    for (const req of reqs[type]) {
      initial[req.equipmentType] = req.mandatory ? req.minQuantity : 0;
    }
    return initial;
  };

  // Below, facility-type/mode changes are plain controlled-form state
  // updates: they are handled directly in the relevant onChange handlers
  // rather than with useEffect, since no server communication is needed to
  // react to them.
  const handleTypeChange = (newType) => {
    setSelectedType(newType);
    setQuantities(defaultQuantitiesFor(newType, requirements));
    setMode('auto');
    setSelectedFacilityId('');
  };

  const handleChooseDirect = () => {
    setMode('direct');
    API.getAvailableFacilities(selectedType)
      .then(ids => { setAvailableIds(ids); setSelectedFacilityId(ids[0] || ''); })
      .catch(() => setResult({ variant: 'danger', text: 'Cannot load available facilities' }));
  };

  const handleQuantityChange = (equipmentType, value) => {
    const n = Number(value);
    setQuantities(prev => ({ ...prev, [equipmentType]: Number.isNaN(n) ? 0 : n }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setResult(null);
    if (mode === 'direct' && !selectedFacilityId) {
      setResult({ variant: 'danger', text: 'Please select a facility, or switch to automatic assignment' });
      return;
    }

    const equipment = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([equipmentType, quantity]) => ({ equipmentType, quantity }));

    setSubmitting(true);
    API.createReservation(selectedType, mode === 'direct' ? selectedFacilityId : null, equipment)
      .then((reservation) => {
        setResult({ variant: 'success', text: `Reservation confirmed: facility ${reservation.facilityId}.` });
        // Reset the form to a clean state for this facility type, so the
        // person doesn't see stale values and isn't left wondering whether
        // clicking "Confirm booking" again would create another reservation.
        setQuantities(defaultQuantitiesFor(selectedType, requirements));
        setMode('auto');
        setSelectedFacilityId('');
        props.onReservationCreated && props.onReservationCreated();
      })
      .catch((err) => setResult({ variant: 'danger', text: err.error || 'Booking failed' }))
      .finally(() => setSubmitting(false));
  };

  if (!requirements) return <p>Loading...</p>;

  const reqList = selectedType ? requirements[selectedType] : [];

  return (
    <Row className="justify-content-center">
      <Col xs={12} md={8} lg={6}>
        <h1 className="mb-3">Book a facility</h1>

        {restricted &&
          <Alert variant="warning">
            Your score is negative ({user.score}). You can only book with the minimum
            required equipment: optional and additional equipment are disabled.
            Log out and log back in with the TOTP second factor to reset your score.
          </Alert>
        }

        {result && (
          <Alert variant={result.variant} dismissible onClose={() => setResult(null)}>
            {result.text}
            {result.variant === 'success' &&
              <div className="mt-2">
                <Button size="sm" variant="outline-success" onClick={() => navigate('/reservations')}>
                  View my reservations
                </Button>
              </div>
            }
          </Alert>
        )}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Facility type</Form.Label>
            <Form.Select value={selectedType} onChange={ev => handleTypeChange(ev.target.value)}>
              {facilityTypes.map(t => <option key={t} value={t}>{FACILITY_LABELS[t] || t}</option>)}
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Facility selection</Form.Label>
            <div>
              <Form.Check inline type="radio" label="Automatic assignment" name="mode"
                checked={mode === 'auto'} onChange={() => setMode('auto')} />
              <Form.Check inline type="radio" label="Choose a specific facility" name="mode"
                checked={mode === 'direct'} onChange={handleChooseDirect} />
            </div>
            {mode === 'direct' &&
              <Form.Select className="mt-2" value={selectedFacilityId} onChange={ev => setSelectedFacilityId(ev.target.value)}>
                {availableIds.length === 0 && <option value="">No facility currently available</option>}
                {availableIds.map(id => <option key={id} value={id}>{id}</option>)}
              </Form.Select>
            }
          </Form.Group>

          <Card className="mb-3">
            <Card.Header>Equipment</Card.Header>
            <Card.Body>
              {reqList.map(req => (
                <Form.Group as={Row} className="mb-2 align-items-center" key={req.equipmentType}>
                  <Form.Label column sm={7}>
                    {EQUIPMENT_LABELS[req.equipmentType] || req.equipmentType}
                    {req.mandatory && <span className="text-muted"> (min. {req.minQuantity})</span>}
                    {!req.mandatory && <span className="text-muted"> (optional)</span>}
                  </Form.Label>
                  <Col sm={5}>
                    <Form.Control
                      type="number"
                      min={req.mandatory ? req.minQuantity : 0}
                      value={quantities[req.equipmentType] ?? (req.mandatory ? req.minQuantity : 0)}
                      disabled={restricted || (!req.mandatory && restricted)}
                      onChange={ev => handleQuantityChange(req.equipmentType, ev.target.value)}
                    />
                  </Col>
                </Form.Group>
              ))}
            </Card.Body>
          </Card>

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Booking...' : 'Confirm booking'}
          </Button>
        </Form>
      </Col>
    </Row>
  );
}

export { BookingForm };

// Alice in Wonderland: "Take some more tea," the March Hare said to Alice, very earnestly.
