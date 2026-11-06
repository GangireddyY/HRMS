import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../../common/auth/decorators';
import { AnnouncementsService } from './announcements.service';
import {
  AnnouncementDto,
  AnnouncementQueryDto,
  RecognitionDto,
  RecognitionQueryDto,
  ReviewSuggestionDto,
  RsvpDto,
  SuggestionDto,
  SuggestionQueryDto,
  SurveyAnswersDto,
  SurveyDto,
  SurveyQueryDto,
  UpdateAnnouncementDto,
  UpdateSurveyDto,
} from './dto/engagement.dto';
import { RecognitionService } from './recognition.service';
import { SurveysService } from './surveys.service';

const UUID = new ParseUUIDPipe();

@ApiTags('Engagement')
@ApiBearerAuth()
@Controller({ path: 'engagement', version: '1' })
export class EngagementController {
  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly surveys: SurveysService,
    private readonly recognition: RecognitionService,
  ) {}

  // ---- Announcements & events ------------------------------------------------------------------

  @Get('announcements')
  @RequirePermissions('engagement.view')
  listAnnouncements(@CurrentAuth() auth: AuthContext, @Query() query: AnnouncementQueryDto) {
    return this.announcements.list(auth, query);
  }

  @Post('announcements')
  @RequirePermissions('engagement.announcement.manage')
  createAnnouncement(@CurrentAuth() auth: AuthContext, @Body() dto: AnnouncementDto) {
    return this.announcements.create(auth, dto);
  }

  @Get('announcements/:id')
  @RequirePermissions('engagement.view')
  announcement(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.announcements.get(auth, id);
  }

  @Patch('announcements/:id')
  @RequirePermissions('engagement.announcement.manage')
  updateAnnouncement(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcements.update(auth, id, dto);
  }

  @Delete('announcements/:id')
  @RequirePermissions('engagement.announcement.manage')
  async removeAnnouncement(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.announcements.remove(auth, id);
    return { deleted: true };
  }

  @Post('announcements/:id/publish')
  @RequirePermissions('engagement.announcement.manage')
  publish(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.announcements.publish(auth, id);
  }

  @Post('announcements/:id/archive')
  @RequirePermissions('engagement.announcement.manage')
  archive(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.announcements.archive(auth, id);
  }

  @Get('announcements/:id/tracking')
  @RequirePermissions('engagement.announcement.manage')
  @ApiOperation({ summary: 'Who in the audience has acknowledged or RSVPed' })
  tracking(@Param('id', UUID) id: string) {
    return this.announcements.tracking(id);
  }

  @Post('announcements/:id/acknowledge')
  @RequirePermissions('engagement.view')
  acknowledge(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.announcements.acknowledge(auth, id);
  }

  @Post('announcements/:id/rsvp')
  @RequirePermissions('engagement.view')
  rsvp(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: RsvpDto) {
    return this.announcements.rsvp(auth, id, dto);
  }

  // ---- Surveys ---------------------------------------------------------------------------------

  @Get('surveys')
  @RequirePermissions('engagement.view')
  listSurveys(@CurrentAuth() auth: AuthContext, @Query() query: SurveyQueryDto) {
    return this.surveys.list(auth, query);
  }

  @Post('surveys')
  @RequirePermissions('engagement.survey.manage')
  createSurvey(@CurrentAuth() auth: AuthContext, @Body() dto: SurveyDto) {
    return this.surveys.create(auth, dto);
  }

  @Get('surveys/:id')
  @RequirePermissions('engagement.view')
  survey(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.surveys.get(auth, id);
  }

  @Patch('surveys/:id')
  @RequirePermissions('engagement.survey.manage')
  updateSurvey(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateSurveyDto) {
    return this.surveys.update(auth, id, dto);
  }

  @Delete('surveys/:id')
  @RequirePermissions('engagement.survey.manage')
  async removeSurvey(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.surveys.remove(auth, id);
    return { deleted: true };
  }

  @Post('surveys/:id/open')
  @RequirePermissions('engagement.survey.manage')
  openSurvey(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.surveys.open(auth, id);
  }

  @Post('surveys/:id/close')
  @RequirePermissions('engagement.survey.manage')
  closeSurvey(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.surveys.close(auth, id);
  }

  @Post('surveys/:id/responses')
  @RequirePermissions('engagement.survey.respond')
  @ApiOperation({ summary: 'Answer a survey (once)' })
  respond(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: SurveyAnswersDto) {
    return this.surveys.respond(auth, id, dto);
  }

  @Get('surveys/:id/results')
  @RequirePermissions('engagement.survey.manage')
  @ApiOperation({ summary: 'Aggregated results (hidden for anonymous surveys below the response threshold)' })
  results(@Param('id', UUID) id: string) {
    return this.surveys.results(id);
  }

  // ---- Recognition -----------------------------------------------------------------------------

  @Get('recognitions')
  @RequirePermissions('engagement.view')
  recognitions(@CurrentAuth() auth: AuthContext, @Query() query: RecognitionQueryDto) {
    return this.recognition.feed(auth, query);
  }

  @Get('recognitions/stats')
  @RequirePermissions('engagement.view')
  recognitionStats(@CurrentAuth() auth: AuthContext) {
    return this.recognition.stats(auth);
  }

  @Post('recognitions')
  @RequirePermissions('engagement.recognition.give')
  give(@CurrentAuth() auth: AuthContext, @Body() dto: RecognitionDto) {
    return this.recognition.give(auth, dto);
  }

  @Delete('recognitions/:id')
  @RequirePermissions('engagement.view')
  async removeRecognition(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.recognition.remove(auth, id);
    return { deleted: true };
  }

  @Get('colleagues')
  @RequirePermissions('engagement.recognition.give')
  @ApiOperation({ summary: 'Active colleagues (name, code, department, designation) to recognise' })
  colleagues(@CurrentAuth() auth: AuthContext, @Query('search') search?: string) {
    return this.recognition.colleagues(auth, typeof search === 'string' ? search.slice(0, 100) : undefined);
  }

  // ---- Suggestions -----------------------------------------------------------------------------

  @Post('suggestions')
  @RequirePermissions('engagement.recognition.give')
  suggest(@CurrentAuth() auth: AuthContext, @Body() dto: SuggestionDto) {
    return this.recognition.suggest(auth, dto);
  }

  @Get('suggestions')
  @RequirePermissions('engagement.view')
  suggestions(@CurrentAuth() auth: AuthContext, @Query() query: SuggestionQueryDto) {
    return this.recognition.suggestions(auth, query);
  }

  @Patch('suggestions/:id')
  @RequirePermissions('engagement.survey.manage')
  review(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReviewSuggestionDto) {
    return this.recognition.review(auth, id, dto);
  }
}
