import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { CourseSkillsDto, MatrixQueryDto, MySkillDto, RequirementsDto, SkillDto, SkillQueryDto, UpdateSkillDto, VerifySkillDto } from './dto/training.dto';
import { SkillsService } from './skills.service';

const UUID = new ParseUUIDPipe();

function requireAny(auth: AuthContext, ...permissions: string[]) {
  if (!auth.features.has('training')) throw AppError.forbidden('Training is not enabled for your organization');
  if (!permissions.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
}

@ApiTags('Skills')
@ApiBearerAuth()
@Controller({ path: 'skills', version: '1' })
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  // ---- Catalog ----

  @Get()
  @RequireTenant()
  list(@CurrentAuth() auth: AuthContext, @Query() query: SkillQueryDto) {
    requireAny(auth, 'training.view', 'training.manage', 'training.assign');
    return this.skills.list(auth, query);
  }

  @Post()
  @RequirePermissions('training.manage')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: SkillDto) {
    return this.skills.create(auth, dto);
  }

  @Patch(':id')
  @RequirePermissions('training.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateSkillDto) {
    return this.skills.update(auth, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('training.manage')
  async remove(@Param('id', UUID) id: string) {
    await this.skills.remove(id);
    return { deleted: true };
  }

  // ---- Role requirements & courses ----

  @Get('requirements/all')
  @RequireTenant()
  @ApiOperation({ summary: 'Skills each designation needs' })
  requirements(@CurrentAuth() auth: AuthContext) {
    requireAny(auth, 'training.manage', 'training.assign');
    return this.skills.requirements();
  }

  @Put('requirements/:designationId')
  @RequirePermissions('training.manage')
  setRequirements(@CurrentAuth() auth: AuthContext, @Param('designationId', UUID) designationId: string, @Body() dto: RequirementsDto) {
    return this.skills.setRequirements(auth, designationId, dto);
  }

  @Get('courses/:courseId')
  @RequireTenant()
  @ApiOperation({ summary: 'Skills a course teaches' })
  courseSkills(@CurrentAuth() auth: AuthContext, @Param('courseId', UUID) courseId: string) {
    requireAny(auth, 'training.view', 'training.manage', 'training.assign');
    return this.skills.courseSkills(courseId);
  }

  @Put('courses/:courseId')
  @RequirePermissions('training.manage')
  setCourseSkills(@CurrentAuth() auth: AuthContext, @Param('courseId', UUID) courseId: string, @Body() dto: CourseSkillsDto) {
    return this.skills.setCourseSkills(auth, courseId, dto);
  }

  // ---- People ----

  @Get('me/profile')
  @RequirePermissions('training.view')
  @ApiOperation({ summary: 'My skills, what my role needs, gaps and courses that close them' })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.skills.mine(auth);
  }

  @Put('me/profile')
  @RequirePermissions('training.view')
  setMine(@CurrentAuth() auth: AuthContext, @Body() dto: MySkillDto) {
    return this.skills.setMine(auth, dto);
  }

  @Delete('me/profile/:skillId')
  @RequirePermissions('training.view')
  removeMine(@CurrentAuth() auth: AuthContext, @Param('skillId', UUID) skillId: string) {
    return this.skills.removeMine(auth, skillId);
  }

  @Get('matrix/view')
  @RequireTenant()
  @ApiOperation({ summary: 'People in scope × skills, with the levels their roles need' })
  matrix(@CurrentAuth() auth: AuthContext, @Query() query: MatrixQueryDto) {
    requireAny(auth, 'training.manage', 'training.assign');
    return this.skills.matrix(auth, query);
  }

  @Get('employees/:employeeId')
  @RequireTenant()
  employee(@CurrentAuth() auth: AuthContext, @Param('employeeId', UUID) employeeId: string) {
    requireAny(auth, 'training.manage', 'training.assign');
    return this.skills.employee(auth, employeeId);
  }

  @Post('employees/:employeeId/:skillId/verify')
  @RequireTenant()
  @ApiOperation({ summary: 'Confirm the level of a skill (manager in scope or HR; never your own)' })
  verify(@CurrentAuth() auth: AuthContext, @Param('employeeId', UUID) employeeId: string, @Param('skillId', UUID) skillId: string, @Body() dto: VerifySkillDto) {
    requireAny(auth, 'training.manage', 'training.assign');
    return this.skills.verify(auth, employeeId, skillId, dto);
  }
}
