import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { UserRole, AttemptStatus } from "@prisma/client"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      )
    }

    const { id } = await params

    // Check if quiz exists
    const quiz = await db.quiz.findUnique({
      where: { id }
    })

    if (!quiz) {
      return NextResponse.json(
        { message: "Quiz not found" },
        { status: 404 }
      )
    }

    // Get enrolled students
    const enrolledStudents = await db.quizUser.findMany({
      where: {
        quizId: id
      },
      include: {
        user: true
      }
    })

    // Get student attempts for this quiz
    const studentAttempts = await db.quizAttempt.findMany({
      where: {
        quizId: id,
        userId: { in: enrolledStudents.map(e => e.userId) }
      }
    })

    // Group attempts by user
    const attemptsByUser = new Map()
    studentAttempts.forEach(attempt => {
      if (!attemptsByUser.has(attempt.userId)) {
        attemptsByUser.set(attempt.userId, [])
      }
      attemptsByUser.get(attempt.userId).push(attempt)
    })

    const studentsWithStats = enrolledStudents.map(enrollment => {
      const user = enrollment.user
      const attempts = attemptsByUser.get(user.id) || []
      const completedAttempts = attempts.filter(a => a.status === AttemptStatus.SUBMITTED)

      return {
        ...user,
        attempts: attempts.length,
        completedAttempts: completedAttempts.length,
        bestScore: completedAttempts.length > 0
          ? Math.max(...completedAttempts.map(a => a.score || 0))
          : null,
        lastAttempt: attempts.length > 0
          ? attempts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
          : null
      }
    })

    return NextResponse.json(studentsWithStats)
  } catch (error) {
    console.error("Error fetching students:", error)
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      )
    }

    const { id } = await params
    const { studentIds } = await request.json()

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json(
        { message: "Student IDs are required" },
        { status: 400 }
      )
    }

    // Check if quiz exists
    const quiz = await db.quiz.findUnique({
      where: { id }
    })

    if (!quiz) {
      return NextResponse.json(
        { message: "Quiz not found" },
        { status: 404 }
      )
    }

    // Check for existing enrollments to avoid duplicates
    const existingEnrollments = await db.quizUser.findMany({
      where: {
        quizId: id,
        userId: { in: studentIds }
      }
    })

    const enrolledStudentIds = existingEnrollments.map(enrollment => enrollment.userId)
    const newStudentIds = studentIds.filter(id => !enrolledStudentIds.includes(id))

    if (newStudentIds.length === 0) {
      return NextResponse.json(
        { message: "All selected students are already enrolled" },
        { status: 400 }
      )
    }

    // Create quiz enrollments only for new students
    const quizEnrollments = await Promise.all(
      newStudentIds.map(studentId =>
        db.quizUser.create({
          data: {
            userId: studentId,
            quizId: id
          }
        })
      )
    )

    // Create initial quiz attempts for enrolled students
    const quizAttempts = await Promise.all(
      newStudentIds.map(studentId =>
        db.quizAttempt.create({
          data: {
            userId: studentId,
            quizId: id,
            startedAt: new Date(),
            status: AttemptStatus.STARTED, // Assuming initial status
          }
        })
      )
    )

    return NextResponse.json({
      message: "Students enrolled successfully",
      enrolledCount: quizEnrollments.length,
      alreadyEnrolled: enrolledStudentIds.length
    })
  } catch (error) {
    console.error("Error enrolling students:", error)
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    )
  }
}