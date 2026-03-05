import express from "express";
import Organization from "../models/organization.model.js";

const router = express.Router();

/*
Create organization
*/
router.post("/", async (req, res) => {
    try
    {
        const org = new Organization(req.body);
        await org.save();

        res.json(org);
    }
    catch (error)
    {
        res.status(500).json({ error: error.message });
    }
});

/*
Get all organizations
*/
router.get("/", async (req, res) => {
    try
    {
        const orgs = await Organization.find().sort({ createdAt: -1 });
        res.json(orgs);
    }
    catch (error)
    {
        res.status(500).json({ error: error.message });
    }
});

export default router;
