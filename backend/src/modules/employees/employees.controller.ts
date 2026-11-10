import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import {
  CreateEmployeeDto,
  CreateFromMembersDto,
  EducationDto,
  EmployeeListQueryDto,
  ExperienceDto,
  ExpiringDocumentsQueryDto,
  FamilyMemberDto,
  ImportEmployeesQueryDto,
  LifecycleActionDto,
  OrgChartQueryDto,
  ReviewBankChangeDto,
  ReviewDocumentDto,
  SensitiveDetailsDto,
  UpdateDocumentDto,
  UpdateEducationDto,
  UpdateEmployeeDto,
  UpdateExperienceDto,
  UpdateFamilyMemberDto,
  UpdateMyEmployeeDto,
  UploadDocumentDto,
} from './dto/employees.dto';
import { DOCUMENT_UPLOAD_LIMIT_BYTES, EmployeeDocumentsService, type UploadedDocumentFile } from './employee-documents.service';
import { EmployeeImportService, IMPORT_FILE_MAX_BYTES } from './employee-import.service';
import { EmployeeProfileService } from './employee-profile.service';
import { EmployeesService } from './employees.service';
import { BankDetailsService } from './bank-details.service';

const UUID = new ParseUUIDPipe();

/** `attachment` with an ASCII fallback and the UTF-8 name (RFC 6266 / 5987). */
const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

@ApiTags('Employees')
@ApiBearerAuth()
@Controller({ path: 'employees', version: '1' })
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly profile: EmployeeProfileService,
    private readonly documents: EmployeeDocumentsService,
    private readonly importer: EmployeeImportService,
    private readonly bank: BankDetailsService,
  ) {}

  // Static routes first so they are not captured by ":id".

  @Get('bank-changes')
  @RequirePermissions('employee.view', 'employee.sensitive.view')
  @ApiOperation({ summary: 'Salary bank account changes waiting for a second approval' })
  bankChanges(@CurrentAuth() auth: AuthContext) {
    return this.bank.list(auth);
  }

  @Post('bank-changes/:changeId/approve')
  @RequirePermissions('employee.view', 'employee.update', 'employee.sensitive.view')
  @ApiOperation({ summary: 'Approve a bank account change (not the requester, not the employee)' })
  approveBankChange(@CurrentAuth() auth: AuthContext, @Param('changeId', UUID) changeId: string) {
    return this.bank.approve(auth, changeId);
  }

  @Post('bank-changes/:changeId/reject')
  @RequirePermissions('employee.view', 'employee.update', 'employee.sensitive.view')
  rejectBankChange(@CurrentAuth() auth: AuthContext, @Param('changeId', UUID) changeId: string, @Body() dto: ReviewBankChangeDto) {
    return this.bank.reject(auth, changeId, dto.note);
  }

  @Get('me')
  @RequireTenant()
  @ApiOperation({ summary: "The signed-in user's employee record (null when none is linked)" })
  me(@CurrentAuth() auth: AuthContext) {
    return this.employees.me(auth);
  }

  @Patch('me')
  @RequirePermissions('self.profile.update')
  @ApiOperation({ summary: 'Update own contact, address, emergency contact, marital status and blood group' })
  updateMe(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateMyEmployeeDto) {
    return this.employees.updateMe(auth, dto);
  }

  @Get('export')
  @RequirePermissions('employee.view', 'employee.export')
  @ApiOperation({ summary: 'CSV export of employees within the caller’s scope' })
  async export(@CurrentAuth() auth: AuthContext, @Query() query: EmployeeListQueryDto) {
    const csv = await this.employees.exportCsv(auth, query);
    return new StreamableFile(Buffer.from(`\uFEFF${csv}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="employees.csv"' });
  }

  @Get('import/template')
  @RequirePermissions('employee.create', 'employee.import')
  @ApiOperation({ summary: 'CSV template for the employee import' })
  importTemplate() {
    return new StreamableFile(Buffer.from(`\uFEFF${this.importer.template()}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="employee-import-template.csv"' });
  }

  @Post('import')
  @RequirePermissions('employee.create', 'employee.import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_FILE_MAX_BYTES + 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Import new employees from CSV (up to 10,000 rows). All rows are validated first; nothing is saved unless every row is valid.' })
  import(@CurrentAuth() auth: AuthContext, @Query() query: ImportEmployeesQueryDto, @UploadedFile() file?: { buffer: Buffer; size: number }) {
    return this.importer.import(auth, file, !!query.dryRun);
  }

  @Get('org-chart')
  @RequirePermissions('employee.view')
  @ApiOperation({ summary: 'One level of the reporting hierarchy (top level, or the direct reports of managerId)' })
  orgChart(@CurrentAuth() auth: AuthContext, @Query() query: OrgChartQueryDto) {
    return this.employees.orgChart(auth, query.managerId);
  }

  @Get('documents/expiring')
  @RequirePermissions('employee.document.manage')
  @ApiOperation({ summary: 'Documents that expired or expire soon, within the caller’s scope' })
  expiringDocuments(@CurrentAuth() auth: AuthContext, @Query() query: ExpiringDocumentsQueryDto) {
    return this.documents.expiring(auth, query.days ?? 30);
  }

  @Get('linkable-members')
  @RequirePermissions('employee.create')
  @ApiOperation({ summary: 'Users without an employee record (to link on creation)' })
  linkableMembers() {
    return this.employees.linkableMembers();
  }

  @Post('from-members')
  @RequirePermissions('employee.create')
  @ApiOperation({ summary: 'Create employee records for users who do not have one yet' })
  createFromMembers(@CurrentAuth() auth: AuthContext, @Body() dto: CreateFromMembersDto) {
    return this.employees.createFromMembers(auth, dto.membershipIds);
  }

  @Get()
  @RequirePermissions('employee.view')
  list(@CurrentAuth() auth: AuthContext, @Query() query: EmployeeListQueryDto) {
    return this.employees.list(auth, query);
  }

  @Post()
  @RequirePermissions('employee.create')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(auth, dto);
  }

  @Get(':id')
  @RequirePermissions('employee.view')
  get(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.employees.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('employee.view', 'employee.update')
  update(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(auth, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('employee.view', 'employee.delete')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.employees.remove(auth, id);
    return { deleted: true };
  }

  @Post(':id/lifecycle')
  @RequirePermissions('employee.view', 'employee.lifecycle.manage')
  @ApiOperation({ summary: 'Record a transfer, promotion, manager change, status change or confirmation' })
  lifecycle(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: LifecycleActionDto) {
    return this.employees.applyLifecycle(auth, id, dto);
  }

  @Get(':id/history')
  @RequirePermissions('employee.view')
  history(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.employees.history(auth, id);
  }

  @Get(':id/reporting-chain')
  @RequirePermissions('employee.view')
  @ApiOperation({ summary: 'Managers above the employee, nearest first' })
  reportingChain(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.employees.reportingChain(auth, id);
  }

  @Get(':id/sensitive')
  @RequirePermissions('employee.view', 'employee.sensitive.view')
  @ApiOperation({ summary: 'Bank, statutory and identity numbers (decrypted; access is audited)' })
  sensitive(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.employees.getSensitive(auth, id);
  }

  @Put(':id/sensitive')
  @RequirePermissions('employee.view', 'employee.update', 'employee.sensitive.view')
  updateSensitive(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: SensitiveDetailsDto) {
    return this.employees.updateSensitive(auth, id, dto);
  }

  // Profile sections: visible in employee.view scope; editable by the employee themselves or HR with employee.update.

  @Get(':id/family')
  @RequirePermissions('employee.view')
  family(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.profile.list(auth, id, 'family');
  }

  @Post(':id/family')
  @RequirePermissions('employee.view')
  addFamily(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: FamilyMemberDto) {
    return this.profile.create(auth, id, 'family', dto);
  }

  @Patch(':id/family/:itemId')
  @RequirePermissions('employee.view')
  updateFamily(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('itemId', UUID) itemId: string, @Body() dto: UpdateFamilyMemberDto) {
    return this.profile.update(auth, id, 'family', itemId, dto as FamilyMemberDto);
  }

  @Delete(':id/family/:itemId')
  @RequirePermissions('employee.view')
  async removeFamily(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('itemId', UUID) itemId: string) {
    await this.profile.remove(auth, id, 'family', itemId);
    return { deleted: true };
  }

  @Get(':id/education')
  @RequirePermissions('employee.view')
  education(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.profile.list(auth, id, 'education');
  }

  @Post(':id/education')
  @RequirePermissions('employee.view')
  addEducation(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: EducationDto) {
    return this.profile.create(auth, id, 'education', dto);
  }

  @Patch(':id/education/:itemId')
  @RequirePermissions('employee.view')
  updateEducation(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('itemId', UUID) itemId: string, @Body() dto: UpdateEducationDto) {
    return this.profile.update(auth, id, 'education', itemId, dto as EducationDto);
  }

  @Delete(':id/education/:itemId')
  @RequirePermissions('employee.view')
  async removeEducation(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('itemId', UUID) itemId: string) {
    await this.profile.remove(auth, id, 'education', itemId);
    return { deleted: true };
  }

  @Get(':id/experience')
  @RequirePermissions('employee.view')
  experience(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.profile.list(auth, id, 'experience');
  }

  @Post(':id/experience')
  @RequirePermissions('employee.view')
  addExperience(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ExperienceDto) {
    return this.profile.create(auth, id, 'experience', dto);
  }

  @Patch(':id/experience/:itemId')
  @RequirePermissions('employee.view')
  updateExperience(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('itemId', UUID) itemId: string, @Body() dto: UpdateExperienceDto) {
    return this.profile.update(auth, id, 'experience', itemId, dto as ExperienceDto);
  }

  @Delete(':id/experience/:itemId')
  @RequirePermissions('employee.view')
  async removeExperience(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('itemId', UUID) itemId: string) {
    await this.profile.remove(auth, id, 'experience', itemId);
    return { deleted: true };
  }

  // Documents: the employee sees and uploads their own; HR needs employee.document.manage in scope.

  @Get(':id/documents')
  @RequirePermissions('employee.view')
  listDocuments(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.documents.list(auth, id);
  }

  @Post(':id/documents')
  @RequirePermissions('employee.view')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_UPLOAD_LIMIT_BYTES, files: 1, fields: 10 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'category', 'title'],
      properties: { file: { type: 'string', format: 'binary' }, category: { type: 'string' }, title: { type: 'string' }, expiryDate: { type: 'string', format: 'date' } },
    },
  })
  @ApiOperation({ summary: 'Upload a document (PDF, PNG, JPG or WebP, up to 10 MB)' })
  uploadDocument(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UploadDocumentDto, @UploadedFile() file?: UploadedDocumentFile) {
    return this.documents.upload(auth, id, file, dto);
  }

  @Patch(':id/documents/:documentId')
  @RequirePermissions('employee.view')
  updateDocument(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('documentId', UUID) documentId: string, @Body() dto: UpdateDocumentDto) {
    return this.documents.update(auth, id, documentId, dto);
  }

  @Post(':id/documents/:documentId/review')
  @RequirePermissions('employee.view', 'employee.document.manage')
  @ApiOperation({ summary: 'Verify or reject a pending document (the employee is notified)' })
  reviewDocument(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('documentId', UUID) documentId: string, @Body() dto: ReviewDocumentDto) {
    return this.documents.review(auth, id, documentId, dto);
  }

  @Get(':id/documents/:documentId/file')
  @RequirePermissions('employee.view')
  @ApiOperation({ summary: 'Download the document file (opening someone else’s document is audited)' })
  async downloadDocument(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('documentId', UUID) documentId: string) {
    const { doc, stream } = await this.documents.download(auth, id, documentId);
    return new StreamableFile(stream, { type: doc.contentType, length: doc.byteSize, disposition: attachment(doc.fileName) });
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions('employee.view')
  async removeDocument(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('documentId', UUID) documentId: string) {
    await this.documents.remove(auth, id, documentId);
    return { deleted: true };
  }
}
