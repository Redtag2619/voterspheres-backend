# voterspheres-backend
Backend API for VoterSpheres
voterspheres-backend/
├── index.js
├── package.json
├── sql/
│   ├── approval.validate_request.sql
│   └── rollback.execute_request.sql
└── README.md
# VoterSpheres Backend

Production Change Approval & Rollback Control Plane

## Endpoints
- GET /health
- POST /approval/validate
- POST /rollback/execute

## Deployment
- Node 18+
- Render Web Service
- Auto-deploy from Git

## Database
- PostgreSQL
- SQL functions executed manually by DBA
- Source-controlled in /sql
