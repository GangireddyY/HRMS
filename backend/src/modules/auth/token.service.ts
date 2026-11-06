import { Injectable } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { AppConfig } from '../../config/app-config.service';
import { AppError } from '../../common/errors/app-error';

const ACCESS_AUDIENCE = 'hrms:access';
const MFA_AUDIENCE = 'hrms:mfa-challenge';
const ISSUER = 'hrms-api';
const MFA_CHALLENGE_TTL_SECONDS = 300;

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  oid: string | null;
}

export interface MfaChallengeClaims {
  sub: string;
  oid: string | null;
}

/** Signs and verifies JWTs. Access tokens are short-lived and carry no permissions (resolved per request). */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL_SECONDS');
  }

  signAccess(claims: AccessTokenClaims): string {
    return this.jwt.sign(claims, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      audience: ACCESS_AUDIENCE,
      issuer: ISSUER,
      expiresIn: this.accessTtlSeconds,
      algorithm: 'HS256',
    });
  }

  verifyAccess(token: string): AccessTokenClaims {
    return this.verify<AccessTokenClaims>(token, ACCESS_AUDIENCE);
  }

  signMfaChallenge(claims: MfaChallengeClaims): string {
    return this.jwt.sign(claims, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      audience: MFA_AUDIENCE,
      issuer: ISSUER,
      expiresIn: MFA_CHALLENGE_TTL_SECONDS,
      algorithm: 'HS256',
    });
  }

  verifyMfaChallenge(token: string): MfaChallengeClaims {
    try {
      return this.verify<MfaChallengeClaims>(token, MFA_AUDIENCE);
    } catch (e) {
      if (e instanceof AppError && e.code === 'TOKEN_EXPIRED') {
        throw new AppError('TOKEN_EXPIRED', 'The sign-in challenge expired. Please sign in again.');
      }
      throw new AppError('UNAUTHENTICATED', 'Invalid sign-in challenge');
    }
  }

  private verify<T extends object>(token: string, audience: string): T {
    try {
      return this.jwt.verify<T>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        audience,
        issuer: ISSUER,
        algorithms: ['HS256'],
      });
    } catch (e) {
      if (e instanceof TokenExpiredError) throw new AppError('TOKEN_EXPIRED', 'Access token expired');
      throw new AppError('UNAUTHENTICATED', 'Invalid access token');
    }
  }
}
