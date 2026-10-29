# IT HAPPENS @ RAALE #13 — FleetWise Project Report

## 1. What We Built
FleetWise is a production-grade dispatch and fleet allocation web application designed to eliminate manual spreadsheet dispatching and prevent the costly failure modes of double-booking vehicles and drivers. 

### Core Features:
1. **Interactive Dispatch Allocation Console:** Allows dispatchers to select a pending delivery, an available vehicle, and an available driver, enforcing the atomic assignment rule.
2. **Anti-Double-Booking Guard Rails:** Immediate rejection of occupied vehicles, occupied drivers, off-duty drivers, or vehicles undergoing maintenance with informative HTTP 409 error messaging and red alert banners.
3. **Delivery Lifecycle State Machine:** Strict progression (`pending` → `assigned` → `in_transit` → `delivered`) with safeguards preventing invalid jumps (e.g., `pending` directly to `delivered`).
4. **Automated Resource Release:** When a delivery reaches `delivered` or `cancelled`, the associated vehicle and driver are atomically released back to `available`.
5. **3 Live Status Boards:** Filterable and searchable operational grids for Vehicles, Drivers, and Deliveries with lifecycle action buttons.
6. **Automated T1–T12 Edge-Case Test Harness:** Built-in runner executing all 12 mandatory challenge tests with live assertion verification and markdown evidence generation.
7. **Operational Audit Stream:** Comprehensive timestamped log of all assignments, rejections, status progressions, and resource releases.

---

## 2. Data Model & Entities

### Entities & Invariants:
1. **Vehicle:**
   - `vehicle_id` (string, e.g., "V-101")
   - `registration_no` (string, unique plate number)
   - `type` ('Van' | 'Box Truck' | 'Flatbed' | 'EV Cargo' | 'Motorcycle')
   - `capacity` (number, payload in kg)
   - `status` ('available' | 'assigned' | 'maintenance' | 'inactive')
   - *Invariant:* Cannot be transitioned to `maintenance` or `inactive` while `status == 'assigned'`.

2. **Driver:**
   - `driver_id` (string, unique identifier, e.g., "DR-018")
   - `name` (string)
   - `phone` (string)
   - `availability_status` ('available' | 'assigned' | 'unavailable')
   - *Invariant:* Cannot be set to `unavailable` while `availability_status == 'assigned'`.

3. **Delivery:**
   - `delivery_id` (string, e.g., "D-204")
   - `pickup` (string, origin address/hub)
   - `dropoff` (string, destination address)
   - `priority` ('low' | 'medium' | 'high' | 'urgent')
   - `status` ('pending' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled')
   - `scheduled_time` (string)
   - `package_weight` (number, kg)

4. **Assignment:**
   - `assignment_id` (string, e.g., "ASG-701")
   - `delivery_id` (foreign key → Delivery)
   - `vehicle_id` (foreign key → Vehicle)
   - `driver_id` (foreign key → Driver)
   - `assigned_at` (ISO timestamp)
   - `completed_at` (optional ISO timestamp)
   - `is_active` (boolean: `true` when assigned/in_transit; `false` when delivered/cancelled)

---

## 3. Mandatory Assignment Rule (Zero Double-Booking)

### Rule Definition:
A dispatch assignment succeeds **if and only if**:
```
delivery.status == 'pending'
AND vehicle.status == 'available'
AND driver.availability_status == 'available'
AND NOT EXISTS(active_assignment WHERE vehicle_id == selected_vehicle AND is_active == true)
AND NOT EXISTS(active_assignment WHERE driver_id == selected_driver AND is_active == true)
```

### Atomic Commit & Conflict Handling:
- If any check fails, the assignment is rejected immediately with an informative error message (e.g., `"Vehicle V-102 is already assigned to active delivery D-201"`).
- **Zero Partial Updates:** No database records are modified on failure.
- When valid, the engine atomically transitions `vehicle.status = 'assigned'`, `driver.availability_status = 'assigned'`, `delivery.status = 'assigned'`, and persists a new `Assignment` record with `is_active = true`.
- **Concurrent Request Protection:** Serialized transaction execution ensures that if two requests attempt to allocate the same vehicle simultaneously, exactly one succeeds and the second is safely rejected (verified in Test T12).

---

## 4. Methods and Architectural Decisions

### Stack:
- **Frontend:** React 19 SPA, Tailwind CSS v4, Lucide Icons.
- **Backend:** Node.js, Express, TypeScript (`tsx`).
- **State & Transactions:** Synchronized atomic dispatch engine in both Express server API and React client state, guaranteeing consistency whether accessed via REST API or browser UI.

### Key Decisions:
1. **Defensive Double Validation:** Both client UI and server API validate the mandatory assignment rule. Even if client-side validation is bypassed, the server returns HTTP 409 conflict.
2. **Defensive Status Modification:** Vehicles and drivers cannot be toggled to maintenance or off-duty while engaged in an active delivery.
3. **Automatic Resource Release:** Status updates to `delivered` or `cancelled` trigger automatic lookup of the active assignment and set vehicle and driver availability back to `available`.

---

## 5. Results & Test Evidence (T1 to T12 Battery)

All 12 edge cases from Part 5 of the Student Handout were executed against the dispatch engine:

| Test ID | Scenario | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| **T1** | Valid Assignment | Assign available vehicle & driver to pending delivery | All three records reflect assignment atomically | ✅ PASS |
| **T2** | Vehicle Conflict | Assign same vehicle to second active delivery | Blocked: Vehicle is already assigned to active delivery | ✅ PASS |
| **T3** | Driver Conflict | Assign same driver to second active delivery | Blocked: Driver is already assigned to active delivery | ✅ PASS |
| **T4** | Both Occupied | Choose occupied vehicle and occupied driver | Rejected with clear reason | ✅ PASS |
| **T5** | Unavailable Driver | Set driver unavailable, then assign | Rejected: Driver is marked UNAVAILABLE | ✅ PASS |
| **T6** | Maintenance Vehicle | Select vehicle in maintenance | Rejected: Vehicle is in MAINTENANCE | ✅ PASS |
| **T7** | Unknown ID | Use missing vehicle, driver or delivery ID | Handled safely: Entity does not exist, no crash | ✅ PASS |
| **T8** | Complete Delivery | Mark assigned/in-transit delivery delivered | Closes delivery; vehicle and driver released to available | ✅ PASS |
| **T9** | Cancel Delivery | Cancel eligible assigned delivery | Delivery cancelled; resources released consistently | ✅ PASS |
| **T10** | Invalid Transition | Mark pending delivery delivered directly | Blocked invalid transition: pending cannot jump to delivered | ✅ PASS |
| **T11** | Duplicate Submit | Submit same assignment twice quickly | Safety lock: Exactly 1 active assignment created, duplicate rejected | ✅ PASS |
| **T12** | Concurrent Requests | Two requests attempt same vehicle at once | Exactly 1 assignment accepted; conflicting attempt blocked | ✅ PASS |

**Score:** 12 / 12 Tests Passed (100% compliance).

---

## 6. Team Work & Reflection
- **Task Ownership:**
  - Architecture & Core Assignment Engine: Lead System Architect
  - Express REST API & Health/Status Endpoints: Backend Engineer
  - Dispatcher Console & Status Grids: Frontend Engineer
  - Test Harness & Edge-Case Verification: QA & Test Engineer
- **Dead End Encountered:**
  - Initial consideration of client-only state was discarded because concurrent API calls and non-browser integrations require server-enforced atomic locks. Dual-layer validation was implemented instead.

---

## 7. Limitations & Next Steps
- **Current Limitations:** Route mapping is simulated via location strings rather than live GPS telemetry.
- **Next Steps:**
  1. Add GPS route telematics and geofenced automated arrival detection.
  2. Implement driver shift rotation and automated rest-period compliance.
  3. Introduce automated payload optimization matching pallet dimensions against vehicle cubic volume.

---

## 8. How to Run
```bash
# Install dependencies
npm install

# Start the full-stack dev server (Express + Vite on port 3000)
npm run dev

# Or build and run production server
npm run build
npm start
```
- Open `http://localhost:3000` in the browser.
- Run `POST /api/run-tests` to verify test battery programmatically.
