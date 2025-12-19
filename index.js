const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const crypto = require("crypto");

const admin = require("firebase-admin");

const serviceAccount = require("./scholarship-stream-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}

// Middleware
const app = express();
const port = process.env.PORT || 3000;

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    res.status(401).send({ message: "unauthorized access" });
  }
};

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
    const paymentCollection = db.collection("payments");
    const reviewCollection = db.collection("reviews");
    const moderatorCollection = db.collection("moderators");

    // ===== Users =====
    app.post("/users", async (req, res) => {
      const { email, displayName, photoURL, uid } = req.body;

      if (!email) {
        return res.status(400).send({ message: "email is required" });
      }

      const userExists = await userCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const user = {
        email,
        displayName,
        photoURL,
        uid,
        role: "student",
        createdAt: new Date(),
      };

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // ===== Moderator Api ====
    app.get("/moderators", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = moderatorCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/moderators", async (req, res) => {
      const moderator = req.body;
      moderator.status = "pending";
      moderator.createdAt = new Date();

      const result = await moderatorCollection.insertOne(moderator);
      console.log("moderator applied");
      res.send(result);
    });

    app.patch("/moderators/:id", verifyFBToken, async (req, res) => {
      try {
        const { status } = req.body;
        const id = req.params.id;

        const moderator = await moderatorCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!moderator) {
          return res.status(404).send({ message: "Moderator not found" });
        }

        const result = await moderatorCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (status === "approved") {
          await userCollection.updateOne(
            { email: moderator.email },
            { $set: { role: "moderator" } }
          );
        }
        if (status !== "approved") {
          await userCollection.updateOne(
            { email: moderator.email },
            { $set: { role: "student" } }
          );
        }

        res.send(result);
      } catch (error) {
        res.send(error);
      }
    });

    app.delete("/moderators/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;

        const result = await moderatorCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .send({ message: "Moderator application not found" });
        }

        res.send({
          success: true,
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // ===== Applications =====
    app.get("/applications", async (req, res) => {
      const email = req.query.email;
      const options = { sort: { applicationDate: -1 } };
      const result = await applicationCollection
        .find({ userEmail: email }, options)
        .toArray();
      res.json(result);
    });

    app.get("/applications/:id", async (req, res) => {
      const id = req.params.id;
      const app = await applicationCollection.findOne({
        _id: new ObjectId(id),
      });
      res.json(app);
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

    app.patch("/applications/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { email, universityName, subjectCategory, degree } = req.body;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const query = {
          _id: new ObjectId(id),
          userEmail: email,
        };

        const application = await applicationCollection.findOne(query);

        if (!application) {
          return res.status(404).send({ message: "Application not found" });
        }

        if (application.applicationStatus !== "pending") {
          return res
            .status(403)
            .send({ message: "Only pending applications can be edited" });
        }

        const updateDoc = {
          $set: {
            ...(universityName && { universityName }),
            ...(subjectCategory && { subjectCategory }),
            ...(degree && { degree }),
          },
        };

        const result = await applicationCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("PATCH /applications error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.delete("/applications/:id", verifyFBToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { email } = req.query;

        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const application = await applicationCollection.findOne({
          _id: new ObjectId(id),
          userEmail: email,
        });

        if (!application) {
          return res.status(404).send({ message: "Applications not found" });
        }

        if (application.applicationStatus?.trim().toLowerCase() !== "pending") {
          return res
            .status(403)
            .send({ message: "Only pending applications can deleted" });
        }

        const result = await applicationCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({
          success: true,
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
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
        const result = await reviewCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Post review
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
        scholarshipName,
      } = req.body;

      if (!applicationId || !userEmail || !ratingPoint) {
        return res.status(400).json({
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
          scholarshipName: scholarshipName || "",
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

    // PAYMENT API
    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      if (email) {
        query.customerEmail = email;

        if (email !== req.decoded_email) {
          res.status(403).send({ message: "Forbidden Access" });
        }
      }

      const result = await paymentCollection
        .find(query)
        .sort({ paidAt: -1 })
        .toArray();
      res.json(result);
    });

    app.post("/create-checkout-session", async (req, res) => {
      const {
        totalCost,
        scholarshipName,
        universityName,
        userEmail,
        scholarshipId,
        applicationId,
      } = req.body;

      if (!userEmail) {
        return res.status(400).json({ message: "User email required" });
      }

      const amount = Math.round(Number(totalCost) * 100);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: scholarshipName,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        customer_email: userEmail,
        mode: "payment",
        metadata: {
          scholarshipId,
          applicationId,
          scholarshipName,
          universityName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      console.log(
        "Success URL:",
        `${process.env.SITE_DOMAIN}/dashboard/payment-success`
      );

      console.log(session);
      res.send({ url: session.url });
      //   res.redirect(303, session.url);
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId) {
          return res
            .status(400)
            .send({ success: false, message: "Session ID missing" });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.send({ success: false });
        }

        // 🔒 Prevent duplicate payment
        const existingPayment = await paymentCollection.findOne({
          transactionId: session.payment_intent,
        });

        if (existingPayment) {
          return res.send({
            success: true,
            payment: existingPayment,
          });
        }

        const applicationId = session.metadata.applicationId;
        const trackingId = generateTrackingId();

        // ✅ Update application
        await applicationCollection.updateOne(
          { _id: new ObjectId(applicationId) },
          {
            $set: {
              paymentStatus: "paid",
              trackingId,
            },
          }
        );

        // ✅ Create payment document
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          applicationId,
          scholarshipName: session.metadata.scholarshipName,
          universityName: session.metadata.universityName,
          transactionId: session.payment_intent,
          paymentStatus: "paid",
          trackingId,
          paidAt: new Date(),
        };

        await paymentCollection.insertOne(payment);

        // 🔥 RETURN FULL PAYMENT INFO
        res.send({
          success: true,
          payment,
        });
      } catch (error) {
        console.error("Payment Success Error:", error);
        res
          .status(500)
          .send({ success: false, message: "Payment processing failed" });
      }
    });

    app.get("/payment/:id", async (req, res) => {
      const id = req.params.id;
      const result = await paymentCollection.findOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    app.get("/", (req, res) => {
      res.send("Scholar Stream API is running");
    });

    app.listen(port, () => console.log(`Server running on port ${port}`));
  } finally {
  }
}

run().catch(console.dir);
