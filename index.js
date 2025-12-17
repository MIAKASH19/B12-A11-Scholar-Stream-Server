const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.9sqbqr2.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("Scholar_Stream_DB");
    const userCollection = db.collection("users");
    const scholarshipCollection = db.collection("scholarships");
    const applicationCollection = db.collection("applications");
    const reviewCollection = db.collection("reviews");

    // ===== Users =====
    app.post("/users", async (req, res) => {
      const newUser = { ...req.body, role: req.body.role || "Student" };
      const existingUser = await userCollection.findOne({
        email: newUser.email,
      });
      if (existingUser) {
        return res.json({
          success: true,
          message: "User already exists",
          user: existingUser,
        });
      }
      const result = await userCollection.insertOne(newUser);
      res.json(result);
    });

    // ===== Applications =====
    app.get("/applications", async (req, res) => {
      const email = req.query.email;
      const result = await applicationCollection
        .find({ userEmail: email })
        .toArray();
      res.json(result);
    });

    app.post("/applications", async (req, res) => {
      try {
        const newApplication = req.body;
        const exists = await applicationCollection.findOne({
          userId: newApplication.userId,
          scholarshipId: newApplication.scholarshipId,
        });
        if (exists) return res.status(409).json({ message: "Already applied" });

        const result = await applicationCollection.insertOne(newApplication);
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to submit application" });
      }
    });

    // ---- Scholarships -----
    app.get("/scholarships", async (req, res) => {
      const result = await scholarshipCollection.find().toArray();
      res.json(result);
    });

    app.get("/scholarship-details/:id", async (req, res) => {
      const id = req.params.id;
      const scholarship = await scholarshipCollection.findOne({
        _id: new ObjectId(id),
      });
      res.json(scholarship);
    });

    app.get("/recent-scholarships", async (req, res) => {
      const result = await scholarshipCollection
        .find()
        .sort({ scholarshipPostDate: -1 })
        .limit(6)
        .toArray();
      res.json(result);
    });

    // *** Reviews API *****
    app.get("/reviews", async (req, res) => {
      const { scholarshipId, applicationId, email } = req.query;
      let query = {};

      if (scholarshipId) query.scholarshipId = new ObjectId(scholarshipId);
      if (applicationId) query.applicationId = new ObjectId(applicationId);
      if (email) query.userEmail = email;

      try {
        const reviews = await reviewCollection.find(query).toArray();
        res.json(reviews);
      } catch (error) {
        console.error("GET /reviews error:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    app.patch("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      const { reviewComment, ratingPoint } = req.body;

      if (!reviewComment && !ratingPoint) {
        return res.status(400).send({ message: "Nothing to update" });
      }

      const updateDoc = {};
      if (reviewComment) updateDoc.reviewComment = reviewComment;
      if (ratingPoint) updateDoc.ratingPoint = Number(ratingPoint);
      updateDoc.reviewDate = new Date();

      try {
        const result = await reviewCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateDoc }
        );
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.delete("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await reviewCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Post review api creation
    app.post("/reviews", async (req, res) => {
      const {
        applicationId,
        scholarshipId,
        userImage,
        userName,
        userEmail,
        universityName,
        ratingPoint,
        reviewComment,
      } = req.body;

      if (!applicationId || !userEmail || !ratingPoint) {
        return res
          .status(400)
          .json({
            message: "applicationId, userEmail and ratingPoint are required",
          });
      }

      try {
        const exists = await reviewCollection.findOne({
          applicationId: new ObjectId(applicationId),
          userEmail: userEmail,
        });

        if (exists)
          return res.status(409).json({ message: "Review already submitted" });

        const reviewDoc = {
          applicationId: new ObjectId(applicationId),
          scholarshipId: scholarshipId ? new ObjectId(scholarshipId) : null,
          userImage: userImage || "",
          userName: userName || "Anonymous",
          userEmail,
          universityName: universityName || "",
          ratingPoint: Number(ratingPoint),
          reviewComment: reviewComment || "",
          reviewDate: new Date(),
        };

        const result = await reviewCollection.insertOne(reviewDoc);
        res.json({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("POST /reviews error:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    app.get("/", (req, res) => {
      res.send("Scholar Stream API is running");
    });

    app.listen(port, () => console.log(`Server running on port ${port}`));
  } finally {
  }
}

run().catch(console.dir);
