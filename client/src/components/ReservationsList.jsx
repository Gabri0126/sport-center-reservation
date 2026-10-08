import { useEffect, useState } from 'react';
import { Card, Row, Col, Form, Button, Alert, Spinner } from 'react-bootstrap';
import API from '../API.js';
import { FACILITY_LABELS, EQUIPMENT_LABELS } from './Home.jsx';

function ReservationCard({ reservation, requirements, restricted, onChanged }) {
  const reqList = requirements[reservation.facilityType] || [];

  // build the full editable set: everything already rented, plus optional
  // equipment types not yet rented (so they can be added).
  const initialQuantities = {};
  for (const item of reservation.equipment) initialQuantities[item.equipmentType] = item.quantity;
  for (const req of reqList) if (!(req.equipmentType in initialQuantities)) initialQuantities[req.equipmentType] = 0;

  const [editing, setEditing] = useState(false);
  const [quantities, setQuantities] = useState(initialQuantities);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { variant, text }

  const startEditing = () => {
    setQuantities(initialQuantities);
    setMessage(null);
    setEditing(true);
  };

  const handleSave = () => {
    // The server API works with deltas (add/remove), not absolute
    // quantities, so we diff the edited values against the quantities the
    // reservation had when editing started.
    const addEquipment = [];
    const removeEquipment = [];
    for (const [equipmentType, newQty] of Object.entries(quantities)) {
      const oldQty = initialQuantities[equipmentType] || 0;
      if (newQty > oldQty) addEquipment.push({ equipmentType, quantity: newQty - oldQty });
      else if (newQty < oldQty) removeEquipment.push({ equipmentType, quantity: oldQty - newQty });
    }
    if (addEquipment.length === 0 && removeEquipment.length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    API.modifyReservation(reservation.id, addEquipment, removeEquipment)
      .then(() => {
        setMessage({ variant: 'success', text: 'Reservation updated.' });
        setEditing(false);
        onChanged();
      })
      .catch(err => setMessage({ variant: 'danger', text: err.error || 'Update failed' }))
      .finally(() => setBusy(false));
  };

  const handleDelete = () => {
    setBusy(true);
    API.deleteReservation(reservation.id)
      .then(() => onChanged())
      .catch(err => { setMessage({ variant: 'danger', text: err.error || 'Delete failed' }); setConfirmingDelete(false); })
      .finally(() => setBusy(false));
  };

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span>
          <strong>{FACILITY_LABELS[reservation.facilityType] || reservation.facilityType}</strong>
          {' '}— facility <code>{reservation.facilityId}</code>
        </span>
        {!confirmingDelete
          ? <Button size="sm" variant="outline-danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>Delete</Button>
          : (
            <span>
              <span className="me-2">Confirm deletion?</span>
              <Button size="sm" variant="danger" disabled={busy} onClick={handleDelete}>Yes, delete</Button>{' '}
              <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            </span>
          )}
      </Card.Header>
      <Card.Body>
        {message && <Alert variant={message.variant} dismissible onClose={() => setMessage(null)}>{message.text}</Alert>}

        {!editing ? (
          <>
            <ul className="mb-2">
              {reservation.equipment.map(item => (
                <li key={item.equipmentType}>
                  {EQUIPMENT_LABELS[item.equipmentType] || item.equipmentType}: {item.quantity}
                </li>
              ))}
            </ul>
            <Button size="sm" variant="outline-primary" onClick={startEditing}>
              {restricted ? 'Remove equipment' : 'Edit equipment'}
            </Button>
          </>
        ) : (
          <>
            {reqList.map(req => {
              const current = initialQuantities[req.equipmentType] || 0;
              const floor = req.mandatory ? req.minQuantity : 0;
              // Restricted (negative-score) users may only remove equipment,
              // never add optional or additional mandatory equipment.
              const ceiling = restricted ? current : undefined;
              return (
                <Form.Group as={Row} className="mb-2 align-items-center" key={req.equipmentType}>
                  <Form.Label column sm={7}>
                    {EQUIPMENT_LABELS[req.equipmentType] || req.equipmentType}
                    {req.mandatory && <span className="text-muted"> (min. {req.minQuantity})</span>}
                    {!req.mandatory && <span className="text-muted"> (optional)</span>}
                  </Form.Label>
                  <Col sm={5}>
                    <Form.Control
                      type="number"
                      min={floor}
                      max={ceiling}
                      value={quantities[req.equipmentType]}
                      onChange={ev => {
                        let n = Number(ev.target.value);
                        if (Number.isNaN(n)) n = floor;
                        if (restricted) n = Math.min(n, current);
                        setQuantities(prev => ({ ...prev, [req.equipmentType]: n }));
                      }}
                    />
                  </Col>
                </Form.Group>
              );
            })}
            {restricted &&
              <p className="text-muted small">
                Your score is negative: you can only remove equipment here, not add optional or additional mandatory equipment.
              </p>}
            <Button size="sm" className="me-2" disabled={busy} onClick={handleSave}>Save</Button>
            <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          </>
        )}
      </Card.Body>
    </Card>
  );
}

function ReservationsList({ user, refreshUser }) {
  const [reservations, setReservations] = useState(null);
  const [requirements, setRequirements] = useState(null);
  const [error, setError] = useState('');

  const restricted = user.score < 0;

  const refresh = () => {
    API.getReservations().then(setReservations).catch(() => setError('Cannot load reservations'));
  };

  useEffect(() => {
    refresh();
    API.getFacilityRequirements().then(setRequirements).catch(() => setError('Cannot load facility requirements'));
  }, []);

  return (
    <>
      <h1 className="mb-3">My reservations</h1>
      {error && <Alert variant="danger">{error}</Alert>}
      {(!reservations || !requirements) ? <Spinner /> : (
        reservations.length === 0
          ? <p className="text-muted">You have no reservations yet.</p>
          : reservations.map(r => (
            <ReservationCard
              key={r.id}
              reservation={r}
              requirements={requirements}
              restricted={restricted}
              onChanged={() => { refresh(); refreshUser(); }}
            />
          ))
      )}
    </>
  );
}

export { ReservationsList };

// Alice in Wonderland: "It would be so nice if something made sense for a change."
