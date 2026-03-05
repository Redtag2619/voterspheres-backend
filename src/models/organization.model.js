import mongoose from "mongoose";

const organizationSchema = new mongoose.Schema(
{
    name: {
        type: String,
        required: true
    },

    type: {
        type: String,
        enum: ["consulting_firm", "campaign", "pac", "vendor"],
        default: "consulting_firm"
    },

    subscriptionPlan: {
        type: String,
        enum: ["free", "pro", "enterprise"],
        default: "free"
    },

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }

},
{ timestamps: true }
);

export default mongoose.model("Organization", organizationSchema);
