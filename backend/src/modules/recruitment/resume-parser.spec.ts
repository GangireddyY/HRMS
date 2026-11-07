import { parseResume, rangeMonths } from './resume-parser';

const TODAY = new Date('2026-11-06T00:00:00Z');

describe('resume parser', () => {
  it('reads contact details, the current role, experience and skills from a typical resume', () => {
    const text = `RIYA SHARMA
Senior Software Engineer
riya.sharma@Example.com | +91 98765 43210 | linkedin.com/in/riya-sharma
Location: Pune, India

PROFESSIONAL SUMMARY
Backend engineer with 6+ years of experience building payment systems. Notice period: 2 months.

WORK EXPERIENCE
Acme Payments | Senior Software Engineer | Jan 2021 – Present
• Led the migration to Node.js microservices on AWS and Kubernetes
Globex — Software Engineer   Jun 2018 - Dec 2020
• Built REST APIs in Java with PostgreSQL

EDUCATION
B.Tech, Computer Science · 2014 - 2018

SKILLS
TypeScript, nodejs, React, Docker, C++, Excel`;
    const r = parseResume(text, ['Payments Domain', 'Kafka Streams'], TODAY);
    expect(r).toMatchObject({
      firstName: 'Riya',
      lastName: 'Sharma',
      email: 'riya.sharma@example.com',
      phone: '+91 98765 43210',
      linkedinUrl: 'https://www.linkedin.com/in/riya-sharma',
      location: 'Pune, India',
      currentTitle: 'Senior Software Engineer',
      currentCompany: 'Acme Payments',
      experienceYears: 6,
      noticePeriodDays: 60,
    });
    expect(r.skills).toEqual(expect.arrayContaining(['Node.js', 'AWS', 'Kubernetes', 'Microservices', 'REST APIs', 'Java', 'PostgreSQL', 'TypeScript', 'React', 'Docker', 'C++', 'Excel']));
    expect(r.skills).not.toContain('JavaScript');
    expect(r.skills).not.toContain('SQL');
  });

  it('adds up job date ranges when no total is stated, ignoring education', () => {
    const text = `Arjun Mehta
arjun@mail.in
Experience
Business Analyst
Initech Pvt Ltd
03/2022 - present
Analyst, Hooli · Jul 2019 to Feb 2022
Education
MBA 2017 - 2019`;
    const r = parseResume(text, [], TODAY);
    expect(r).toMatchObject({ firstName: 'Arjun', lastName: 'Mehta', currentTitle: 'Business Analyst', currentCompany: 'Initech Pvt Ltd' });
    // Jul 2019 – Nov 2026 continuous = 89 months
    expect(r.experienceYears).toBe(7.4);
    expect(r.phone).toBeUndefined();
  });

  it('merges overlapping ranges and ignores future or implausible ones', () => {
    expect(rangeMonths('Jan 2020 - Dec 2020\nJun 2020 - Jun 2021', TODAY)).toBe(18);
    expect(rangeMonths('2030 - 2031', TODAY)).toBe(0);
    expect(rangeMonths('2021 - 2019', TODAY)).toBe(0);
  });

  it('leaves out what it cannot find and reads an immediate notice period', () => {
    const r = parseResume('Curriculum Vitae\n\nI am an immediate joiner. Contact: 2019 - 2021', [], TODAY);
    expect(r).toEqual({ noticePeriodDays: 0, skills: [] });
  });
});
