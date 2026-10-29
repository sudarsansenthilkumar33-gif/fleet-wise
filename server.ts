import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { FleetState, Vehicle, Driver, Delivery, Assignment } from './src/types/fleet';
import { INITIAL_FLEET_STATE } from './src/data/seedData';
import {
  assignDispatch,
  transitionDeliveryStatus,
  changeVehicleStatus,
  changeDriverStatus,
  runTestSuite
} from './src/lib/dispatchEngine';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory fleet database synchronized with transactional dispatch engine
let fleetState: FleetState = JSON.parse(JSON.stringify(INITIAL_FLEET_STATE));

// Health check endpoint (Part 4.0 API Contract)
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'FleetWise Vehicle & Delivery Assignment System',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    stats: {
      vehicles: fleetState.vehicles.length,
      drivers: fleetState.drivers.length,
      deliveries: fleetState.deliveries.length,
      activeAssignments: fleetState.assignments.filter(a => a.is_active).length
    }
  });
});

// Provide raw handout PDF download/view link
app.get('/api/sample-handout', (_req: Request, res: Response) => {
  try {
    const pdfPath = path.resolve(process.cwd(), 'public/assets/aistudio/IT_HAPPENS_RAALE_13_FleetWise_Handout_2d28efe7.pdf');
    if (fs.existsSync(pdfPath)) {
      const fileBuffer = fs.readFileSync(pdfPath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="IT_HAPPENS_RAALE_13_FleetWise_Handout.pdf"');
      res.send(fileBuffer);
    } else {
      res.status(404).json({ success: false, error: 'FleetWise PDF not found on disk' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get full fleet state
app.get('/api/state', (_req: Request, res: Response) => {
  res.json({ success: true, data: fleetState });
});

// Reset to seed data
app.post('/api/reset', (_req: Request, res: Response) => {
  fleetState = JSON.parse(JSON.stringify(INITIAL_FLEET_STATE));
  res.json({
    success: true,
    message: 'FleetWise database reset to initial demonstration state.',
    data: fleetState
  });
});

// --- VEHICLES API ---
app.get('/api/vehicles', (_req: Request, res: Response) => {
  res.json({ success: true, count: fleetState.vehicles.length, data: fleetState.vehicles });
});

app.post('/api/vehicles', (req: Request, res: Response) => {
  const { registration_no, type, capacity, capacity_unit = 'kg', notes } = req.body;

  if (!registration_no || !type || !capacity) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Registration number, vehicle type, and capacity are required.'
    });
  }

  // Check unique registration
  const duplicate = fleetState.vehicles.find(
    v => v.registration_no.toLowerCase().trim() === registration_no.toLowerCase().trim()
  );
  if (duplicate) {
    return res.status(409).json({
      error: 'DUPLICATE_REGISTRATION',
      message: `Vehicle with registration '${registration_no}' already exists (${duplicate.vehicle_id}).`
    });
  }

  const vehicle_id = req.body.vehicle_id || `V-${Math.floor(100 + Math.random() * 900)}`;
  const newVehicle: Vehicle = {
    vehicle_id,
    registration_no: registration_no.toUpperCase().trim(),
    type,
    capacity: Number(capacity),
    capacity_unit,
    status: 'available',
    notes,
    created_at: new Date().toISOString()
  };

  fleetState.vehicles.push(newVehicle);
  fleetState.auditLogs.unshift({
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action_type: 'RESOURCE_CREATED',
    details: `Added new vehicle ${newVehicle.vehicle_id} (${newVehicle.registration_no}, ${newVehicle.type}, ${newVehicle.capacity}${newVehicle.capacity_unit}).`,
    vehicle_id: newVehicle.vehicle_id,
    severity: 'info'
  });

  res.status(201).json({ success: true, message: 'Vehicle created successfully', data: newVehicle });
});

app.patch('/api/vehicles/:id/status', (req: Request, res: Response) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Status is required.' });
  }

  const result = changeVehicleStatus(fleetState, req.params.id, status);
  if (!result.success) {
    return res.status(409).json({ error: 'STATUS_UPDATE_FAILED', message: result.message });
  }

  fleetState = result.state!;
  res.json({ success: true, message: result.message, data: fleetState.vehicles.find(v => v.vehicle_id === req.params.id) });
});

// --- DRIVERS API ---
app.get('/api/drivers', (_req: Request, res: Response) => {
  res.json({ success: true, count: fleetState.drivers.length, data: fleetState.drivers });
});

app.post('/api/drivers', (req: Request, res: Response) => {
  const { name, phone, license_no } = req.body;

  if (!name || !phone) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Driver name and phone number are required.'
    });
  }

  const driver_id = req.body.driver_id || `DR-${Math.floor(100 + Math.random() * 900)}`;

  // Check unique driver ID
  const duplicateId = fleetState.drivers.find(d => d.driver_id.toLowerCase() === driver_id.toLowerCase());
  if (duplicateId) {
    return res.status(409).json({
      error: 'DUPLICATE_DRIVER_ID',
      message: `Driver ID '${driver_id}' is already registered.`
    });
  }

  const newDriver: Driver = {
    driver_id,
    name: name.trim(),
    phone: phone.trim(),
    availability_status: 'available',
    license_no: license_no?.trim(),
    rating: 5.0,
    created_at: new Date().toISOString()
  };

  fleetState.drivers.push(newDriver);
  fleetState.auditLogs.unshift({
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action_type: 'RESOURCE_CREATED',
    details: `Registered new driver ${newDriver.name} (${newDriver.driver_id}, phone: ${newDriver.phone}).`,
    driver_id: newDriver.driver_id,
    severity: 'info'
  });

  res.status(201).json({ success: true, message: 'Driver created successfully', data: newDriver });
});

app.patch('/api/drivers/:id/status', (req: Request, res: Response) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Status is required.' });
  }

  const result = changeDriverStatus(fleetState, req.params.id, status);
  if (!result.success) {
    return res.status(409).json({ error: 'STATUS_UPDATE_FAILED', message: result.message });
  }

  fleetState = result.state!;
  res.json({ success: true, message: result.message, data: fleetState.drivers.find(d => d.driver_id === req.params.id) });
});

// --- DELIVERIES API ---
app.get('/api/deliveries', (_req: Request, res: Response) => {
  res.json({ success: true, count: fleetState.deliveries.length, data: fleetState.deliveries });
});

app.post('/api/deliveries', (req: Request, res: Response) => {
  const { pickup, dropoff, priority = 'medium', scheduled_time, package_weight, notes } = req.body;

  if (!pickup || !dropoff) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Pickup and dropoff locations are required.'
    });
  }

  const delivery_id = req.body.delivery_id || `D-${Math.floor(200 + Math.random() * 800)}`;
  const now = new Date().toISOString();

  const newDelivery: Delivery = {
    delivery_id,
    pickup: pickup.trim(),
    dropoff: dropoff.trim(),
    priority,
    status: 'pending',
    scheduled_time: scheduled_time?.trim() || 'Next Available Slot',
    package_weight: package_weight ? Number(package_weight) : undefined,
    notes: notes?.trim(),
    created_at: now,
    updated_at: now
  };

  fleetState.deliveries.push(newDelivery);
  fleetState.auditLogs.unshift({
    id: `log-${Date.now()}`,
    timestamp: now,
    action_type: 'RESOURCE_CREATED',
    details: `Created new delivery order ${newDelivery.delivery_id}: ${newDelivery.pickup} -> ${newDelivery.dropoff} (Priority: ${newDelivery.priority.toUpperCase()}).`,
    delivery_id: newDelivery.delivery_id,
    severity: 'info'
  });

  res.status(201).json({ success: true, message: 'Delivery created in pending status', data: newDelivery });
});

// --- ASSIGNMENT ENDPOINT (Part 4.1 - 4.3 Mandatory Rule) ---
app.post('/api/deliveries/:id/assign', (req: Request, res: Response) => {
  const delivery_id = req.params.id;
  const { vehicle_id, driver_id } = req.body;

  if (!vehicle_id || !driver_id) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Both vehicle_id and driver_id are required in assignment body.'
    });
  }

  // Execute atomic assignment rule
  const result = assignDispatch(fleetState, delivery_id, vehicle_id, driver_id);

  if (!result.success) {
    // Audit log conflict attempt for observability
    fleetState.auditLogs.unshift({
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      action_type: 'ASSIGN_REJECTED',
      details: `Assignment REJECTED for Delivery ${delivery_id}: ${result.message}`,
      delivery_id,
      vehicle_id,
      driver_id,
      severity: 'error'
    });

    return res.status(409).json({
      error: result.error || 'ASSIGNMENT_CONFLICT',
      message: result.message
    });
  }

  // Atomically update state
  fleetState = result.state!;

  res.status(200).json({
    delivery_id,
    vehicle_id,
    driver_id,
    status: 'assigned',
    message: result.message,
    assignment: result.assignment
  });
});

// --- STATUS UPDATE ENDPOINT (Part 4 & Part 2.3) ---
app.patch('/api/deliveries/:id/status', (req: Request, res: Response) => {
  const delivery_id = req.params.id;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Status field is required.' });
  }

  const result = transitionDeliveryStatus(fleetState, delivery_id, status);

  if (!result.success) {
    return res.status(400).json({
      error: result.error || 'INVALID_TRANSITION',
      message: result.message
    });
  }

  fleetState = result.state!;

  res.json({
    success: true,
    message: result.message,
    delivery_id,
    status,
    releasedVehicleId: result.releasedVehicleId,
    releasedDriverId: result.releasedDriverId
  });
});

// --- AUTOMATED T1 - T12 TEST RUNNER ENDPOINT ---
app.post('/api/run-tests', (_req: Request, res: Response) => {
  const testRun = runTestSuite(fleetState);
  res.json({
    success: true,
    passedCount: testRun.passedCount,
    totalCount: testRun.totalCount,
    results: testRun.results
  });
});

// Configure Vite integration
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FleetWise Server running on port ${PORT} (${isProduction ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start FleetWise server:', err);
  process.exit(1);
});
