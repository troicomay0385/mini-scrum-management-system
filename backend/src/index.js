const express = require("express");
const http = require("http");
const { initSocket } = require("./socket");
const cors = require("cors");
const dotenv = require("dotenv");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const userstoryRoutes = require('./routes/userstoryRoutes');
const standupRoutes = require('./routes/standupRoutes');
const multer = require('multer');
const path = require('path');
// ... các import khác
const commentRoutes = require('./routes/commentRoutes');
const attachmentRoutes = require('./routes/attachmentRoutes');
const sprintCeremonyRoutes = require('./routes/sprintCeremonyRoutes');
const sprintSummaryRoutes  = require('./routes/sprintSummaryRoutes');


dotenv.config();
const app = express();
const prisma = new PrismaClient();
// Cấu hình CORS cho phép frontend truy cập
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);
app.use(cors({
  origin: true,
  credentials: true
}));
// app.use(cors({
//   origin: function (origin, callback) {
//     if (!origin) return callback(null, true);
//     if (allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }
//     if (origin.endsWith('.vercel.app')) {
//       return callback(null, true);
//     }
//     callback(new Error('Not allowed by CORS'));
//   },
//   methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
//   credentials: true
// }));

//app.use(cors({
  //origin: function (origin, callback) {
    // Cho phép tất cả origin trong quá trình dev (bao gồm cả không có origin - Postman, mobile,...)
    //callback(null, true);
  //},
  //methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  //allowedHeaders: ['Content-Type', 'Authorization'],
  //credentials: true
//}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Đăng ký API
app.use('/api', commentRoutes);
app.use('/api/attachments', attachmentRoutes);


// Middleware auth (dùng cho tất cả route cần quyền)
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // Bearer token
  if (!token) {
    return res.status(401).json({ error: "Không có token" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "mini_scrum_secret");
    req.user = decoded; // { userId, email, role }
    next();
  } catch (err) {
    res.status(401).json({ error: "Token không hợp lệ" });
  }
};


app.use('/api/user-stories', userstoryRoutes);
app.use('/api/standups', authMiddleware, standupRoutes);
app.use('/api/sprints', authMiddleware, sprintCeremonyRoutes);
// Mô-đun Tổng kết Sprint (End Sprint & Contribution Assessment)
// Auth được áp dụng bên trong router, không đưa vào đây để tránh chặn /api/login
app.use('/api', sprintSummaryRoutes);

console.log("🚀 Backend Mini Scrum Management System - Sprint 1 đang chạy...");

// Test server
app.get("/", (req, res) => {
  res.json({ message: "Backend Sprint 1 đang chạy tốt!" });
});

// US-001: ĐĂNG KÝ
app.post("/api/register", async (req, res) => {
  const { email, password, fullName } = req.body;
  
  // Validation password strength
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ error: "Mật khẩu phải từ 8 ký tự, bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt" });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, fullName },
    });
    res.status(201).json({ message: "Đăng ký thành công!", userId: user.id });
  } catch (err) {
    res
      .status(400)
      .json({ error: "Email đã tồn tại hoặc dữ liệu không hợp lệ" });
  }
});

// US-002: ĐĂNG NHẬP (từ code 2, đơn giản hơn nhưng giữ đầy đủ)
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Email không tồn tại hoặc sai mật khẩu" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Email không tồn tại hoặc sai mật khẩu" });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "mini_scrum_secret",
      { expiresIn: "1d" }
    );
    res.json({
      message: "Đăng nhập thành công",
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Lỗi server khi đăng nhập" });
  }
});

// US-036: LẤY DANH SÁCH PROJECT (Chỉ lấy các project user tham gia)
app.get("/api/project", authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  try {
    const projects = await prisma.project.findMany({
      where: {
        members: {
          some: { userId, status: "ACCEPTED" }
        }
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy danh sách dự án" });
  }
});

// US-039: TÌM KIẾM NGƯỜI DÙNG (Để gợi ý khi mời)
app.get("/api/users/search", authMiddleware, async (req, res) => {
  const { query } = req.query;
  if (!query || query.length < 2) return res.json([]);
  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: query } },
          { fullName: { contains: query } }
        ]
      },
      select: { id: true, email: true, fullName: true },
      take: 10
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Lỗi tìm kiếm người dùng" });
  }
});

// US-039: MỜI THÀNH VIÊN VÀO PROJECT (Sử dụng mời thông minh)
app.post("/api/project/:projectId/invite", authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  const { userId, role = "MEMBER" } = req.body;
  const requesterId = req.user.userId;

  try {
    // Kiểm tra requester có phải PO không
    const requester = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: requesterId, projectId } },
    });

    if (!requester || (requester.role !== "PO" && requester.role !== "SM")) {
      return res.status(403).json({ error: "Chỉ Product Owner (PO) hoặc Scrum Master (SM) mới có quyền mời thành viên!" });
    }

    // Mời thành viên với trạng thái PENDING (dùng upsert để reset nếu họ đã từng ở trong dự án)
    const member = await prisma.projectMember.upsert({
      where: { userId_projectId: { userId, projectId } },
      update: { status: "PENDING", role },
      create: { userId, projectId, role, status: "PENDING" },
    });
    res.json({ message: "Đã gửi lời mời tham gia dự án!", member });
  } catch (err) {
    res.status(400).json({ error: "Lỗi khi gửi lời mời: " + err.message });
  }
});

// US-040: LẤY DANH SÁCH LỜI MỜI ĐANG CHỜ
app.get("/api/invitations", authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  try {
    const invitations = await prisma.projectMember.findMany({
      where: { userId, status: "PENDING" },
      include: {
        project: {
          select: { name: true }
        }
      }
    });
    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy lời mời" });
  }
});

// US-041: PHẢN HỒI LỜI MỜI (ACCEPT / DECLINE)
app.post("/api/invitations/:id/respond", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // "ACCEPT" or "DECLINE"
  const userId = req.user.userId;

  try {
    const invitation = await prisma.projectMember.findFirst({
      where: { id, userId }
    });

    if (!invitation) return res.status(404).json({ error: "Không tìm thấy lời mời" });

    if (action === "ACCEPT") {
      await prisma.projectMember.update({
        where: { id },
        data: { status: "ACCEPTED" }
      });
      res.json({ message: "Chào mừng! Bạn đã tham gia dự án." });
    } else {
      // Decline = Xóa luôn theo yêu cầu của User
      await prisma.projectMember.delete({ where: { id } });
      res.json({ message: "Đã từ chối lời mời." });
    }
  } catch (err) {
    res.status(500).json({ error: "Lỗi phản hồi lời mời" });
  }
});

// Chi tiết Project (đổ dữ liệu cũ cho EditProject)
app.get("/api/project/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const project = await prisma.project.findUnique({
      where: { id },
    });
    if (!project) {
      return res.status(404).json({ error: "Không tìm thấy Project" });
    }
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: "Lỗi server khi lấy chi tiết dự án" });
  }
});

// CẬP NHẬT PROJECT (US-036 - Extend)
app.patch("/api/project/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, description, goal } = req.body;
  const userId = req.user.userId;

  try {
    // Kiểm tra quyền (CHỈ PO hoặc SM)
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId: id } },
    });

    if (!member || (member.role !== "PO" && member.role !== "SM")) {
      return res.status(403).json({ error: "Bạn không có quyền chỉnh sửa thông tin dự án này." });
    }

    const updatedProject = await prisma.project.update({
      where: { id },
      data: {
        name: name || undefined,
        description: description !== undefined ? description : undefined,
        goal: goal !== undefined ? goal : undefined,
      },
    });

    res.json({ message: "Cập nhật dự án thành công", project: updatedProject });
  } catch (err) {
    console.error("Update project error:", err);
    res.status(500).json({ error: "Lỗi khi cập nhật dự án" });
  }
});

// TẠO PROJECT (US-036)
app.post("/api/project", authMiddleware, async (req, res) => {
  const { name, description, goal } = req.body;
  const userId = req.user.userId;

  try {
    const project = await prisma.project.create({
      data: { name, description, goal },
    });

    // Tự động gán người tạo làm Product Owner (PO)
    await prisma.projectMember.create({
      data: { userId, projectId: project.id, role: "PO" }
    });

    res.json({ message: "Tạo Project thành công", projectId: project.id });
  } catch (err) {
    res.status(400).json({ error: "Lỗi khi tạo dự án: " + err.message });
  }
});

// US-039 & US-004: THÊM THÀNH VIÊN + PHÂN QUYỀN (giữ logic kiểm tra PO từ code 1)
app.post("/api/project/:projectId/members", async (req, res) => {
  const { projectId } = req.params;
  const { userId, role = "MEMBER", requesterId } = req.body;

  try {
    // Kiểm tra requester có phải PO không
    const requester = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: { userId: requesterId, projectId },
      },
    });

    if (!requester || (requester.role !== "PO" && requester.role !== "SM")) {
      return res.status(403).json({
        error: "Chỉ Product Owner (PO) hoặc Scrum Master (SM) mới có quyền thêm thành viên!",
      });
    }

    // Mời/Thêm thành viên với trạng thái PENDING (dùng upsert để xử lý nếu đã tồn tại nhưng chưa vào)
    const member = await prisma.projectMember.upsert({
      where: { userId_projectId: { userId, projectId } },
      update: { status: "PENDING", role },
      create: { userId, projectId, role, status: "PENDING" },
    });
    res.json({ message: "Đã gửi yêu cầu tham gia dự án!", member });
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: "Không thể mời thành viên. Lỗi: " + err.message,
    });
  }
});

// Helper kiểm tra quyền PO hoặc SM trong dự án
const checkPOorSM = async (userId, projectId) => {
  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  return member && (member.role === "PO" || member.role === "SM");
};

// TẠO USER STORY - Đã hỗ trợ tags
app.post("/api/userstory", authMiddleware, async (req, res) => {
  const { title, description, projectId, priority = "MEDIUM", status = "BACKLOG", assigneeId, storyPoints, tags = [] } = req.body;

  try {
    const hasPermission = await checkPOorSM(req.user.userId, projectId);
    if (!hasPermission) {
      return res.status(403).json({ error: "Chỉ Product Owner hoặc Scrum Master mới có quyền tạo User Story." });
    }

    const story = await prisma.userStory.create({
      data: {
        title,
        description: description || null,
        projectId,
        priority,
        status,
        assigneeId: assigneeId || null,
        storyPoints: storyPoints ? parseInt(storyPoints) : null,
        tags: JSON.stringify(tags),
        backlogOrder: req.body.backlogOrder || 0,
        sprintId: req.body.sprintId || null,
      },
      include: {
        assignee: { select: { id: true, fullName: true } }
      }
    });

    res.status(201).json({ message: "Tạo User Story thành công", story });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Lỗi khi tạo User Story: " + err.message });
  }
});

// XÓA USER STORY
app.delete("/api/userstory/:id", authMiddleware, async (req, res) => {
  try {
    const story = await prisma.userStory.findUnique({ where: { id: req.params.id } });
    if (!story) return res.status(404).json({ error: "Không tìm thấy User Story" });

    const hasPermission = await checkPOorSM(req.user.userId, story.projectId);
    if (!hasPermission) {
      return res.status(403).json({ error: "Chỉ Product Owner hoặc Scrum Master mới có quyền xóa User Story." });
    }

    await prisma.userStory.delete({ where: { id: req.params.id } });
    res.json({ message: "Xóa User Story thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi xóa User Story" });
  }
});

// US-009: REORDER USER STORIES (PHẢI ĐẶT TRƯỚC /:id để tránh Express match 'reorder' vào :id)
app.patch("/api/userstory/reorder", authMiddleware, async (req, res) => {
  const { stories } = req.body; // Array of { id, backlogOrder }
  if (!stories || !Array.isArray(stories)) {
    return res.status(400).json({ error: "Dữ liệu stories không hợp lệ" });
  }

  try {
    const updates = stories.map(s =>
      prisma.userStory.update({
        where: { id: s.id },
        data: { backlogOrder: parseInt(s.backlogOrder, 10) }
      })
    );
    await prisma.$transaction(updates);
    res.json({ message: "Sắp xếp lại thành công" });
  } catch (err) {
    console.error("Lỗi reorder DB:", err);
    res.status(500).json({ error: "Lỗi khi sắp xếp lại User Stories" });
  }
});

// CẬP NHẬT USER STORY
app.patch("/api/userstory/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { title, description, status, priority, assigneeId, storyPoints } = req.body;
  try {
    const story = await prisma.userStory.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: "Không tìm thấy User Story" });

    // Chỉ PO/SM mới được quyền sửa tiêu đề, mô tả, ưu tiên, point. MEMBER chỉ được sửa status?
    // Wait, the requirement says "Là PO/SM, tôi muốn chỉnh sửa một User Story để cập nhật nội dung"
    // For now, let's enforce PO/SM for all modifications via this endpoint.
    const hasPermission = await checkPOorSM(req.user.userId, story.projectId);
    if (!hasPermission && (title || description || priority !== undefined || storyPoints !== undefined)) {
      return res.status(403).json({ error: "Thành viên thông thường không có quyền chỉnh sửa nội dung hoặc điểm của User Story." });
    }

    // Allow member to update status if they don't update protected fields.
    // Or just checkPOorSM generally. Let's just check PO or SM, except maybe status.
    // wait, member moving card on board modifies status. So if hasPermission is false, and ONLY status is present, allow it!
    if (!hasPermission) {
      const protectedFields = ["title", "description", "priority", "storyPoints", "assigneeId"];
      const updatingProtected = protectedFields.some(field => req.body[field] !== undefined);
      if (updatingProtected) {
        return res.status(403).json({ error: "Bạn không có quyền sửa đổi thông tin chính của User Story." });
      }
    }

    const updated = await prisma.userStory.update({
      where: { id },
      data: {
        title: title !== undefined ? title : undefined,
        description: description !== undefined ? description : undefined,
        status: status !== undefined ? status : undefined,
        priority: priority !== undefined ? priority : undefined,
        assigneeId: assigneeId !== undefined ? assigneeId : undefined,
        storyPoints: storyPoints !== undefined ? (parseInt(storyPoints) || null) : undefined,
        tags: req.body.tags !== undefined ? JSON.stringify(req.body.tags) : undefined,
        sprintId: req.body.sprintId !== undefined ? req.body.sprintId : undefined,
        backlogOrder: req.body.backlogOrder !== undefined ? req.body.backlogOrder : undefined,
      },
    });

    // Nếu thay đổi status, lưu lại lịch sử
    if (status !== undefined && status !== story.status) {
      await prisma.userStoryStatusHistory.create({
        data: {
          storyId: id,
          status: status
        }
      });
    }

    res.json({ message: "Cập nhật thành công", story: updated });
  } catch (err) {
    console.error("Update story error:", err);
    res.status(500).json({ error: "Lỗi cập nhật User Story" });
  }
});

// GÁN USER STORY CHO MEMBER BẰNG EMAIL
app.patch("/api/userstory/:id/assign", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "Không tìm thấy user với email này" });
    const updated = await prisma.userStory.update({
      where: { id: req.params.id },
      data: { assigneeId: user.id }
    });
    res.json({ message: "Gán thành viên thành công", story: updated });
  } catch (err) {
    res.status(500).json({ error: "Lỗi gán User Story" });
  }
});

// XEM CHI TIẾT USER STORY
app.get("/api/userstory/:id", async (req, res) => {
  try {
    const story = await prisma.userStory.findUnique({
      where: { id: req.params.id },
      include: {
        project: true,
        assignee: { select: { fullName: true, email: true, avatar: true } },
        comments: {
          include: { user: { select: { fullName: true, email: true } } },
          orderBy: { createdAt: "asc" }
        }
      },
    });
    if (!story) return res.status(404).json({ error: "Không tìm thấy User Story" });
    res.json(story);
  } catch (err) {
    res.status(500).json({ error: "Lỗi server" });
  }
});

// US-045: LẤY BÌNH LUẬN CỦA USER STORY
app.get("/api/userstory/:id/comments", async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const comments = await prisma.comment.findMany({
      where: { userStoryId: req.params.id },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "asc" }
    });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy bình luận" });
  }
});

// US-045: TẠO BÌNH LUẬN MỚI
app.post("/api/userstory/:id/comments", authMiddleware, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "Nội dung bình luận không được để trống" });

  try {
    const comment = await prisma.comment.create({
      data: {
        content,
        userStoryId: req.params.id,
        userId: req.user.userId
      },
      include: { user: { select: { fullName: true, email: true } } }
    });
    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lưu bình luận" });
  }
});

// XEM DANH SÁCH USER STORIES TRONG PROJECT
app.get("/api/project/:projectId/userstories", async (req, res) => {
  const { projectId } = req.params;
  try {
    const stories = await prisma.userStory.findMany({
      where: { projectId },
      orderBy: [
        { backlogOrder: "asc" },
        { title: "asc" }
      ],
      include: {
        assignee: { select: { fullName: true, email: true, avatar: true } },
        comments: { select: { id: true } },
        tasks: {
          orderBy: { createdAt: "asc" },
          include: { assignee: { select: { id: true, fullName: true, email: true, avatar: true } } }
        }
      }
    });
    // Tránh browser cache để loadData() luôn lấy dữ liệu mới nhất
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(stories);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy danh sách User Stories" });
  }
});

// (Route /reorder đã được chuyển lên trước /:id ở phía trên)

// US-015: LẤY DANH SÁCH SPRINT
app.get("/api/project/:projectId/sprints", authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  try {
    const sprints = await prisma.sprint.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      include: {
        stories: {
          include: {
            assignee: { select: { fullName: true, email: true, avatar: true } },
            comments: { select: { id: true } },
            tasks: {
              include: { assignee: { select: { id: true, fullName: true, email: true, avatar: true } } },
              orderBy: { createdAt: "asc" }
            }
          }
        }
      }
    });
    res.json(sprints);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy danh sách Sprint" });
  }
});

// US-016: TẠO SPRINT MỚI
app.post("/api/project/:projectId/sprints", authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  const { name, goal, startDate, endDate } = req.body;
  try {
    const hasPermission = await checkPOorSM(req.user.userId, projectId);
    if (!hasPermission) {
      return res.status(403).json({ error: "Chỉ Scrum Master hoặc PO mới được tạo Sprint." });
    }

    const sprint = await prisma.sprint.create({
      data: {
        name,
        goal,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        projectId
      }
    });
    res.status(201).json(sprint);
  } catch (err) {
    res.status(400).json({ error: "Lỗi khi tạo Sprint: " + err.message });
  }
});

// US-017: CHI TIẾT SPRINT
app.get("/api/sprint/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const sprint = await prisma.sprint.findUnique({
      where: { id },
      include: {
        stories: {
          include: {
            assignee: { select: { fullName: true, email: true, avatar: true } },
            tasks: {
              include: { assignee: { select: { id: true, fullName: true, email: true, avatar: true } } },
              orderBy: { createdAt: "asc" }
            }
          }
        }
      }
    });
    if (!sprint) return res.status(404).json({ error: "Không tìm thấy Sprint" });
    res.json(sprint);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy chi tiết Sprint" });
  }
});

// US-049: CẬP NHẬT SPRINT (Start Sprint, Complete Sprint)
app.patch("/api/sprint/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, goal, startDate, endDate, status } = req.body;
  try {
    const sprint = await prisma.sprint.findUnique({ where: { id } });
    if (!sprint) return res.status(404).json({ error: "Không tìm thấy Sprint" });

    // Lấy thông tin role của người dùng trong dự án
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: req.user.userId, projectId: sprint.projectId } },
    });

    if (!member || (member.role !== "PO" && member.role !== "SM")) {
      return res.status(403).json({ error: "Bạn không có quyền cập nhật Sprint." });
    }

      // == US-049: Kiểm tra xung đột và quyền hạn khi Bắt đầu Sprint (Start Sprint) ==
      if (status === 'ACTIVE' && sprint.status !== 'ACTIVE') {
        if (member.role !== "SM" && member.role !== "PO") {
          return res.status(403).json({ error: "Chỉ Scrum Master hoặc Product Owner (Chủ dự án) mới có quyền bắt đầu Sprint!" });
        }

        // BẮT BUỘC PHẢI CÓ END DATE KHI BẮT ĐẦU SPRINT
        if (!endDate && !sprint.endDate) {
          return res.status(400).json({ error: "Vui lòng thiết lập ngày kết thúc cho Sprint trước khi bắt đầu!" });
        }

        const activeSprint = await prisma.sprint.findFirst({
          where: { projectId: sprint.projectId, status: 'ACTIVE' }
        });
        if (activeSprint) {
          return res.status(400).json({ error: `Dự án hiện đã có một Sprint đang hoạt động (${activeSprint.name}). Vui lòng kết thúc nó trước khi bắt đầu Sprint mới.` });
        }
      }

    // == US-050: Logic kết thúc Sprint (Complete Sprint) ==
    if (status === 'COMPLETED' && sprint.status === 'ACTIVE') {
      if (member.role !== "SM" && member.role !== "PO") {
        return res.status(403).json({ error: "Chỉ Scrum Master hoặc Product Owner (Chủ dự án) mới có quyền kết thúc Sprint!" });
      }

      const { moveUnfinishedTo } = req.body;
      if (moveUnfinishedTo) {
        // Tìm các story chưa hoàn thành (không phải DONE và không phải REJECTED)
        const unfinishedStories = await prisma.userStory.findMany({
          where: { sprintId: id, NOT: [{ status: 'DONE' }, { status: 'REJECTED' }] }
        });

        if (unfinishedStories.length > 0) {
          const targetSprintId = moveUnfinishedTo === 'BACKLOG' ? null : moveUnfinishedTo;
          const targetStatus = moveUnfinishedTo === 'BACKLOG' ? 'BACKLOG' : 'TODO';

          await prisma.userStory.updateMany({
            where: { id: { in: unfinishedStories.map(s => s.id) } },
            data: { sprintId: targetSprintId, status: targetStatus }
          });
        }
      }
    }

    const updated = await prisma.sprint.update({
      where: { id },
      data: {
        name: name !== undefined ? name : undefined,
        goal: goal !== undefined ? goal : undefined,
        startDate: (status === 'ACTIVE' && !startDate && !sprint.startDate) ? new Date() : (startDate ? new Date(startDate) : undefined),
        endDate: endDate ? new Date(endDate) : undefined,
        status: status !== undefined ? status : undefined,
      }
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi cập nhật Sprint: " + err.message });
  }
});
// Lấy vai trò của người dùng hiện tại trong dự án
app.get("/api/project/:projectId/role", authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.userId;
  try {
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });
    if (!member) return res.json({ role: "NONE" });
    res.json({ role: member.role });
  } catch (err) {
    res.status(500).json({ error: "Lỗi kiểm tra quyền" });
  }
});

// DASHBOARD STATS
app.get("/api/project/:projectId/dashboard", async (req, res) => {
  const { projectId } = req.params;
  try {
    const stories = await prisma.userStory.findMany({ where: { projectId } });
    const total = stories.length;
    const done = stories.filter(s => s.status === 'DONE').length;
    const inProgress = stories.filter(s => s.status === 'IN_PROGRESS').length;
    const todo = stories.filter(s => s.status === 'TODO').length;
    const rejected = stories.filter(s => s.status === 'REJECTED').length;

    // Sum storyPoints properly
    const completedPoints = stories.filter(s => s.status === 'DONE').reduce((sum, s) => sum + (s.storyPoints || 0), 0);
    const totalPoints = stories.reduce((sum, s) => sum + (s.storyPoints || 0), 0);

    // Only count stories that are NOT rejected for progress percentage
    const totalActive = total - rejected;
    const progressPercentage = totalActive > 0 ? Math.round((done / totalActive) * 100) : 0;

    res.json({
      totalStories: total,
      completedStories: done,
      inProgressStories: inProgress,
      todoStories: todo,
      rejectedStories: rejected,
      completedPoints,
      totalPoints,
      progressPercentage
    });
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy dữ liệu Dashboard" });
  }
});

// === ANALYTICS API (US-025, US-026, US-027) ===

// 1. BURNDOWN CHART DATA
app.get("/api/analytics/:projectId/sprint/:sprintId/burndown", authMiddleware, async (req, res) => {
  const { projectId, sprintId } = req.params;
  const requesterId = req.user.userId;

  try {
    // KIỂM TRA QUYỀN (CHỈ PO/SM)
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: requesterId, projectId } }
    });
    if (!member || (member.role !== 'PO' && member.role !== 'SM')) {
      return res.status(403).json({ error: "Chỉ PO hoặc SM mới có quyền xem dữ liệu Burndown." });
    }
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: { stories: { include: { statusHistory: true } } }
    });

    if (!sprint || !sprint.startDate || !sprint.endDate) {
      // Thay vì 400, trả về mảng rỗng và info để frontend hiển thị thông báo nhẹ nhàng hơn nếu cần
      return res.json({ 
        error: "Sprint chưa có ngày bắt đầu/kết thúc.",
        data: [],
        details: "Vui lòng thiết lập ngày tháng cho Sprint để xem biểu đồ Burndown."
      });
    }

    const start = new Date(sprint.startDate);
    const end = new Date(sprint.endDate);

    const getLocalDateString = (date) => {
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const startStr = getLocalDateString(start);
    const endStr = getLocalDateString(end);

    const sDate = new Date(startStr + 'T00:00:00');
    const eDate = new Date(endStr + 'T00:00:00');

    // Calculate inclusive calendar days duration
    const diffTime = Math.abs(eDate - sDate);
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    const totalDays = diffDays + 1;

    const totalPoints = sprint.stories.reduce((sum, s) => sum + (s.storyPoints || 0), 0);
    const data = [];

    // Day 0: Start of Sprint
    const startMonth = start.getMonth() + 1;
    const startDay = start.getDate();
    data.push({
      date: startStr,
      displayDate: `${startDay}/${startMonth} (Bắt đầu)`,
      actual: totalPoints,
      ideal: totalPoints
    });

    let curr = new Date(sDate);
    let dayIdx = 1;

    while (curr <= eDate) {
      const currStr = getLocalDateString(curr);
      const endOfDayLimit = new Date(currStr + 'T23:59:59.999');

      // Calculate remaining points at the end of this day
      let remainingPoints = totalPoints;
      sprint.stories.forEach(story => {
        // Find if story was completed on or before this day
        const doneHistory = story.statusHistory
          .filter(h => h.status === 'DONE' && new Date(h.changedAt) <= endOfDayLimit)
          .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt))[0];

        if (doneHistory) {
          remainingPoints -= (story.storyPoints || 0);
        }
      });

      // Ideal line calculation
      const ideal = Math.max(0, totalPoints - (totalPoints / totalDays) * dayIdx);

      const currMonth = curr.getMonth() + 1;
      const currDay = curr.getDate();

      data.push({
        date: currStr,
        displayDate: `${currDay}/${currMonth}`,
        actual: remainingPoints,
        ideal: parseFloat(ideal.toFixed(2))
      });

      curr.setDate(curr.getDate() + 1);
      dayIdx++;
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi tính toán Burndown" });
  }
});

app.get("/api/analytics/:projectId/velocity", authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  const requesterId = req.user.userId;

  try {
    // KIỂM TRA QUYỀN (CHỈ PO/SM)
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: requesterId, projectId } }
    });
    if (!member || (member.role !== 'PO' && member.role !== 'SM')) {
      return res.status(403).json({ error: "Chỉ PO hoặc SM mới có quyền xem dữ liệu Velocity." });
    }

    console.log(`[Analytics] Fetching Velocity for project: ${projectId}`);
    const sprints = await prisma.sprint.findMany({
      where: { projectId, status: 'COMPLETED' },
      include: { stories: true },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`[Analytics] Found ${sprints.length} completed sprints for velocity.`);

    const data = sprints.map(sprint => {
      const commitment = sprint.stories.reduce((sum, s) => sum + (s.storyPoints || 0), 0);
      const completed = sprint.stories
        .filter(s => s.status === 'DONE')
        .reduce((sum, s) => sum + (s.storyPoints || 0), 0);
      
      return {
        name: sprint.name,
        commitment,
        completed
      };
    });

    res.json(data);
  } catch (err) {
    console.error("[Analytics] Velocity calculation error:", err);
    res.status(500).json({ error: "Lỗi tính toán Velocity" });
  }
});

// 3. SPRINT REPORT EXPORT (US-027)
app.get("/api/analytics/:projectId/sprint/:sprintId/report", authMiddleware, async (req, res) => {
  const { projectId, sprintId } = req.params;
  const { format } = req.query; // 'pdf' or 'excel'
  const requesterId = req.user.userId;

  try {
    // KIỂM TRA QUYỀN (CHỈ PO/SM)
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: requesterId, projectId } }
    });
    if (!member || (member.role !== 'PO' && member.role !== 'SM')) {
      return res.status(403).json({ error: "Chỉ PO hoặc SM mới có quyền xuất báo cáo Sprint." });
    }
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: { 
        stories: { 
          include: { 
            tasks: true,
            assignee: { select: { fullName: true } }
          } 
        },
        project: true
      }
    });

    if (!sprint) return res.status(404).json({ error: "Sprint không tồn tại" });

    // Hỗ trợ tiếng Việt trong filename bằng cách encode
    const safeSprintName = encodeURIComponent(sprint.name).replace(/['()]/g, escape).replace(/\*/g, '%2A');

    if (format === 'excel') {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sprint Report');

      sheet.columns = [
        { header: 'Tiêu đề (Title)', key: 'title', width: 40 },
        { header: 'Điểm (Points)', key: 'points', width: 15 },
        { header: 'Trạng thái', key: 'status', width: 20 },
        { header: 'Người thực hiện', key: 'assignee', width: 25 },
        { header: 'Số Task', key: 'tasks', width: 15 },
      ];

      if (sprint.stories && sprint.stories.length > 0) {
        sprint.stories.forEach(s => {
          sheet.addRow({
            title: s.title,
            points: s.storyPoints || 0,
            status: s.status,
            assignee: s.assignee?.fullName || 'Chưa gán',
            tasks: s.tasks ? s.tasks.length : 0
          });
        });
      } else {
        sheet.addRow({ title: '(Sprint không có User Story nào)' });
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      // Cách thức header chuẩn cho Unicode filename
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''Sprint_Report_${safeSprintName}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    if (format === 'pdf') {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 50 });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''Sprint_Report_${safeSprintName}.pdf`);
      doc.pipe(res);

      // SỬ DỤNG FONT HỆ THỐNG ĐỂ HỖ TRỢ TIẾNG VIỆT
      const fontPath = 'C:\\Windows\\Fonts\\arial.ttf';
      try {
        doc.font(fontPath);
      } catch (fErr) {
        console.warn("Font Arial not found, falling back to default (Vietnamese might break)");
      }

      doc.fontSize(24).fillColor('#0052CC').text(`Báo cáo Sprint: ${sprint.name}`, { align: 'center' });
      doc.moveDown();
      
      doc.fontSize(12).fillColor('#172B4D').text(`Dự án: ${sprint.project.name}`);
      doc.text(`Thời gian: ${sprint.startDate ? new Date(sprint.startDate).toLocaleDateString('vi-VN') : 'N/A'} - ${sprint.endDate ? new Date(sprint.endDate).toLocaleDateString('vi-VN') : 'N/A'}`);
      doc.text(`Mục tiêu: ${sprint.goal || 'Không có mục tiêu cụ thể'}`);
      doc.moveDown(2);

      doc.fontSize(18).fillColor('#0052CC').text('Danh sách User Stories', { underline: true });
      doc.moveDown();

      if (sprint.stories && sprint.stories.length > 0) {
        sprint.stories.forEach((s, index) => {
          doc.fontSize(14).fillColor('#172B4D').text(`${index + 1}. ${s.title}`);
          doc.fontSize(11).fillColor('#6B778C')
             .text(`   Trạng thái: ${s.status} | Điểm: ${s.storyPoints || 0}`)
             .text(`   Người thực hiện: ${s.assignee?.fullName || 'Chưa gán'}`);
          doc.moveDown(0.5);
        });
      } else {
        doc.fontSize(12).text('Sprint này chưa có User Story nào.');
      }

      doc.end();
      return;
    }

    // Default: JSON
    res.json(sprint);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi xuất báo cáo" });
  }
});

// US-037: CHỈNH SỬA THÔNG TIN PROJECT (giữ nguyên từ code 1, có auth)
app.patch("/api/project/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, description, goal } = req.body;
  try {
    console.log("Đang xử lý update cho ID:", id);
    const updatedProject = await prisma.project.update({
      where: { id },
      data: {
        name: name !== undefined ? name : undefined,
        description: description !== undefined ? description : undefined,
        goal: goal !== undefined ? goal : undefined,
      },
    });
    console.log("Update thành công!");
    res.json({ message: "Thành công", project: updatedProject });
  } catch (err) {
    console.error("Lỗi Prisma:", err.message);
    res.status(500).json({ error: "Lỗi kết nối Database hoặc ID không tồn tại" });
  }
});

// US-040: LẤY DANH SÁCH THÀNH VIÊN CỦA PROJECT (có auth)
app.get("/api/project/:projectId/members", authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  try {
    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, email: true, fullName: true, avatar: true } } },
    });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy danh sách thành viên" });
  }
});

// TÌM KIẾM TASK VÀ STORY TRONG PROJECT
app.get("/api/project/:projectId/search-tasks", authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  const { q } = req.query;
  try {
    if (q && q.trim()) {
      const queryStr = q.trim();
      const stories = await prisma.userStory.findMany({
        where: {
          projectId,
          title: { contains: queryStr }
        },
        take: 5,
        orderBy: { updatedAt: 'desc' }
      });
      const tasks = await prisma.task.findMany({
        where: {
          userStory: { projectId },
          title: { contains: queryStr }
        },
        include: {
          userStory: {
            select: { id: true, title: true }
          }
        },
        take: 5,
        orderBy: { updatedAt: 'desc' }
      });
      res.json({ stories, tasks });
    } else {
      const recentStories = await prisma.userStory.findMany({
        where: { projectId },
        take: 2,
        orderBy: { updatedAt: 'desc' }
      });
      const recentTasks = await prisma.task.findMany({
        where: {
          userStory: { projectId }
        },
        include: {
          userStory: {
            select: { id: true, title: true }
          }
        },
        take: 2,
        orderBy: { updatedAt: 'desc' }
      });
      res.json({ stories: recentStories, tasks: recentTasks });
    }
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Lỗi tìm kiếm: " + err.message });
  }
});

// US-040: CẬP NHẬT ROLE CỦA THÀNH VIÊN (có kiểm tra PO)
app.patch("/api/project/:projectId/members/:userId/role", authMiddleware, async (req, res) => {
  const { projectId, userId } = req.params;
  const { role } = req.body;
  const requesterId = req.user.userId;
  try {
    const requester = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: requesterId, projectId } },
    });
    if (!requester || (requester.role !== "PO" && requester.role !== "SM")) {
      return res.status(403).json({ error: "Chỉ PO hoặc SM mới được phân quyền!" });
    }
    if (requesterId === userId) {
      return res.status(400).json({ error: "Không thể đổi role của chính mình!" });
    }
    const updated = await prisma.projectMember.update({
      where: { userId_projectId: { userId, projectId } },
      data: { role },
    });
    res.json({ message: "Cập nhật role thành công", member: updated });
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi cập nhật role" });
  }
});

// US-042: XÓA THÀNH VIÊN KHỎI DỰ ÁN (Chỉ PO)
app.delete("/api/project/:projectId/members/:userId", authMiddleware, async (req, res) => {
  const { projectId, userId } = req.params;
  const requesterId = req.user.userId;

  try {
    const requester = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: requesterId, projectId } },
    });

    if (!requester || requester.role !== "PO") {
      return res.status(403).json({ error: "Chỉ Product Owner (PO) mới có quyền xóa thành viên!" });
    }

    if (requesterId === userId) {
      return res.status(400).json({ error: "Bạn không thể tự xóa chính mình khỏi dự án!" });
    }

    // Lấy thông tin dự án để đưa vào thông báo
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true }
    });

    // Xóa record member
    await prisma.projectMember.delete({
      where: { userId_projectId: { userId, projectId } },
    });

    // Unassign all user stories assigned to this user in this project
    await prisma.userStory.updateMany({
      where: { projectId, assigneeId: userId },
      data: { assigneeId: null }
    });

    // Unassign all tasks assigned to this user in this project
    // Tìm các story trong project để unassign task thuộc các story đó
    const projectStories = await prisma.userStory.findMany({
      where: { projectId },
      select: { id: true }
    });
    const storyIds = projectStories.map(s => s.id);

    await prisma.task.updateMany({
      where: { storyId: { in: storyIds }, assigneeId: userId },
      data: { assigneeId: null }
    });

    // Tạo thông báo cho người bị xóa
    await prisma.notification.create({
      data: {
        userId,
        content: `Bạn đã bị xóa khỏi dự án vì không còn tham gia`,
        type: "KICKED"
      }
    });

    res.json({ message: "Đã xóa thành viên khỏi dự án và gửi thông báo." });
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi xóa thành viên: " + err.message });
  }
});

// XÓA DỰ ÁN (Chỉ PO)
app.delete("/api/project/:projectId", authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.userId;

  try {
    // 1. Kiểm tra quyền PO
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });

    if (!member || member.role !== "PO") {
      return res.status(403).json({ error: "Chỉ Product Owner (PO) mới có quyền xóa dự án!" });
    }

    // 2. Thực hiện xóa toàn bộ dữ liệu liên quan trong transaction
    await prisma.$transaction(async (tx) => {
      // Vì schema có nhiều quan hệ không cascade, ta xóa thủ công theo thứ tự
      
      // Xóa Daily Standups
      await tx.dailyStandup.deleteMany({ where: { projectId } });

      // Xóa Sprints
      await tx.sprint.deleteMany({ where: { projectId } });

      // Xóa User Stories (Các Tasks, Comments, Attachments của story sẽ tự động xóa nếu có onDelete: Cascade)
      // Nhưng để chắc chắn và xử lý các quan hệ trung gian, ta xóa từ ngọn
      const stories = await tx.userStory.findMany({ where: { projectId }, select: { id: true } });
      const storyIds = stories.map(s => s.id);

      // Xóa Tasks liên quan
      await tx.task.deleteMany({ where: { storyId: { in: storyIds } } });
      
      // Xóa User Stories
      await tx.userStory.deleteMany({ where: { projectId } });

      // Xóa Project Members
      await tx.projectMember.deleteMany({ where: { projectId } });

      // Xóa Project
      await tx.project.delete({ where: { id: projectId } });
    });

    res.json({ message: "Dự án đã được xóa vĩnh viễn." });
  } catch (err) {
    console.error("Lỗi xóa dự án:", err);
    res.status(500).json({ error: "Lỗi khi xóa dự án: " + err.message });
  }
});

// SEED: Thêm member đầu tiên (Mặc định là PENDING để đồng bộ)
app.post("/api/project/:projectId/members/seed", async (req, res) => {
  const { projectId } = req.params;
  const { userId, role = "MEMBER" } = req.body;
  try {
    const member = await prisma.projectMember.upsert({
      where: { userId_projectId: { userId, projectId } },
      update: { status: "PENDING", role },
      create: { userId, projectId, role, status: "PENDING" },
    });
    res.json({ message: "Thêm thành công (trạng thái PENDING)", member });
  } catch (err) {
    res.status(400).json({ error: "Dữ liệu không hợp lệ: " + err.message });
  }
});

// === TASK API ===

// US-020: TẠO TASK CHO USER STORY
app.post("/api/userstory/:storyId/tasks", authMiddleware, async (req, res) => {
  const { storyId } = req.params;
  const { title, description, assigneeId, dueDate } = req.body;
  try {
    const task = await prisma.task.create({
      data: {
        title,
        description: description || null,
        storyId,
        status: "TODO",
        assigneeId: assigneeId || null,
        dueDate: dueDate ? new Date(dueDate) : null,
      }
    });
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: "Lỗi khi tạo Task: " + err.message });
  }
});

// US-021: CẬP NHẬT TASK (Status hoặc Details)
app.patch("/api/tasks/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { title, description, status, assigneeId, storyId, dueDate } = req.body;
  try {
    const updated = await prisma.task.update({
      where: { id },
      data: {
        title: title !== undefined ? title : undefined,
        description: description !== undefined ? description : undefined,
        status: status !== undefined ? status : undefined,
        assigneeId: assigneeId !== undefined ? assigneeId : undefined,
        storyId: storyId !== undefined ? storyId : undefined,
        dueDate: dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : undefined,
      }
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: "Lỗi khi cập nhật Task: " + err.message });
  }
});

// GÁN TASK CHO MEMBER BẰNG EMAIL
app.patch("/api/tasks/:id/assign", authMiddleware, async (req, res) => {
  const { email } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "Không tìm thấy user với email này" });

    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: { assigneeId: user.id }
    });
    res.json({ message: "Gán thành viên thành công", task: updated });
  } catch (err) {
    res.status(500).json({ error: "Lỗi gán Task" });
  }
});

// XÓA TASK
app.delete("/api/tasks/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.task.delete({ where: { id } });
    res.json({ message: "Xóa Task thành công" });
  } catch (err) {
    res.status(400).json({ error: "Lỗi khi xóa Task: " + err.message });
  }
});

// Lấy danh sách task của một story
app.get("/api/userstory/:storyId/tasks", authMiddleware, async (req, res) => {
  const { storyId } = req.params;
  try {
    const tasks = await prisma.task.findMany({
      where: { storyId },
      include: { assignee: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: "asc" }
    });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy danh sách Task" });
  }
});

// ==========================================
// US-046: BÌNH LUẬN TRONG TASK
// ==========================================

// 1. Lấy danh sách bình luận của Task
app.get("/api/tasks/:taskId/comments", async (req, res) => {
  const { taskId } = req.params;
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const comments = await prisma.comment.findMany({
      where: { taskId: taskId },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "asc" }
    });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy bình luận của Task" });
  }
});

// 2. Tạo bình luận mới cho Task
app.post("/api/tasks/:taskId/comments", authMiddleware, async (req, res) => {
  const { taskId } = req.params;
  const { content } = req.body;

  if (!content) return res.status(400).json({ error: "Nội dung không được để trống" });

  try {
    const comment = await prisma.comment.create({
      data: {
        content,
        taskId: taskId,
        userId: req.user.userId // Lấy từ authMiddleware
      },
      include: { user: { select: { fullName: true, email: true } } }
    });
    res.status(201).json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi khi lưu bình luận cho Task" });
  }
});

// === USER PROFILE & SETTINGS API ===

const avatarStorage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, 'avatar-' + Date.now() + path.extname(file.originalname));
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Chỉ chấp nhận định dạng file ảnh .jpg, .jpeg, .png!"));
  }
}).single('avatar');

// GET Profile
app.get("/api/user/profile", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, fullName: true, role: true, avatar: true }
    });
    if (!user) return res.status(404).json({ error: "Không tìm thấy người dùng" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Lỗi máy chủ khi lấy thông tin người dùng" });
  }
});

// PATCH Profile (Họ tên + Avatar)
app.patch("/api/user/profile", authMiddleware, (req, res) => {
  avatarUpload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    
    const { fullName } = req.body;
    const updateData = {};
    
    if (fullName !== undefined) {
      if (!fullName || fullName.trim() === '') {
        return res.status(400).json({ error: "Họ và tên không được để trống" });
      }
      
      // Kiểm tra ký tự đặc biệt (@, #, $, ...)
      const specialCharRegex = /[@#\$%\^&\*\(\)\+=\{\}\[\]\<\>\?\/\\\|~`_]/;
      if (specialCharRegex.test(fullName)) {
        return res.status(400).json({ error: "Họ và tên không được chứa ký tự đặc biệt (@, #, $, ...)" });
      }
      updateData.fullName = fullName.trim();
    }
    
    if (req.file) {
      updateData.avatar = `/uploads/${req.file.filename}`;
    }
    
    try {
      const updatedUser = await prisma.user.update({
        where: { id: req.user.userId },
        data: updateData,
        select: { id: true, email: true, fullName: true, role: true, avatar: true }
      });
      res.json({ message: "Cập nhật thông tin cá nhân thành công!", user: updatedUser });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Lỗi máy chủ khi cập nhật thông tin" });
    }
  });
});

// POST Change Password
app.post("/api/user/change-password", authMiddleware, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: "Vui lòng điền đầy đủ tất cả các trường mật khẩu" });
  }
  
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "Mật khẩu xác nhận không khớp" });
  }
  
  // Validate new password strength (at least 8 chars, letter + number)
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
  if (!passwordRegex.test(newPassword)) {
    return res.status(400).json({ error: "Mật khẩu mới phải từ 8 ký tự trở lên, bao gồm cả chữ và số" });
  }
  
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId }
    });
    
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }
    
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Mật khẩu hiện tại không chính xác" });
    }
    
    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { password: hashed }
    });
    
    res.json({ message: "Đổi mật khẩu thành công!" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "Lỗi máy chủ khi đổi mật khẩu" });
  }
});

// === NOTIFICATION API ===

// Lấy danh sách thông báo
app.get("/api/notifications", authMiddleware, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: "desc" },
      take: 20
    });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy thông báo" });
  }
});

// Đánh dấu đã đọc
app.patch("/api/notifications/:id/read", authMiddleware, async (req, res) => {
  try {
    await prisma.notification.update({
      where: { id: req.params.id, userId: req.user.userId },
      data: { isRead: true }
    });
    res.json({ message: "Đã đánh dấu đã đọc" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật thông báo" });
  }
});

// Cho phép truy cập file tĩnh để xem/tải về (duplicate đã loại bỏ, dùng route file attachmentRoutes)


// Lắng nghe cổng
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
initSocket(server, prisma);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server chạy tại http://localhost:${PORT}`);
  console.log(`✅ Server mạng tại http://0.0.0.0:${PORT}`);
  console.log(`🔌 Socket.io đã sẵn sàng`);
});