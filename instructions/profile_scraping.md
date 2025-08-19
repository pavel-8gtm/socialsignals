## Problem 

At the moment we have situation which created duplicates, in case one scraping job creates URL of format like this: https://www.linkedin.com/in/yurevichcv/, but sometimes it has differnet of URL -- https://www.linkedin.com/in/ACoAAAD5j5QBF4iXXWSySmKTfY-TgspnXCjeM9w . even if it's the same person. 

In order to solve this problem at root cause, I suggest running an enrichment job, to parse additional data about each profile, and then smartly unify people into one profile automatiacally. 

To achieve this, you can use this Apify actor.

Here is example input:

{
    "includeEmail": false,
    "usernames": [
        "https://www.linkedin.com/in/ACoAABxF9_ABHx785CFOZ24PjpTJvbvqi6CZH8M"
    ]
}

Here is example Apify response:

[
  {
    "basic_info": {
      "fullname": "Tjitte Joosten",
      "first_name": "Tjitte",
      "last_name": "Joosten",
      "headline": "Founder at RevFixr | SaaS Pricing & Monetisation",
      "public_identifier": "tjittejoosten",
      "profile_picture_url": "https://media.licdn.com/dms/image/v2/D4E03AQEgof_rB3nvBg/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1712263692754?e=1758153600&v=beta&t=w_LKBvEObbaPbWnQKxMsQ-CP317yjMiwxvQ-NzYdMEw",
      "about": "What I do →\n\n• I'm a Founder at RevFixr. \n• I help SaaS and AI companies fix their pricing and packaging.\n• I share these lessons on my Substack https://moneyonthetable.substack.com/",
      "location": {
        "country": "Netherlands",
        "city": "Amsterdam, North Holland",
        "full": "Amsterdam, North Holland, Netherlands",
        "country_code": "NL"
      },
      "creator_hashtags": [
        "saas",
        "growth",
        "pricing",
        "saaspricing"
      ],
      "is_creator": true,
      "is_influencer": false,
      "is_premium": true,
      "created_timestamp": 1452989448246,
      "show_follower_count": true,
      "background_picture_url": "https://media.licdn.com/dms/image/v2/D4E16AQH3-5Au4m4lFg/profile-displaybackgroundimage-shrink_350_1400/B4EZZ.Wy32HcAY-/0/1745876627640?e=1758153600&v=beta&t=KqScM2IVlpdQYAJ-Y6_vBOFI-_9Eh5zZNxVX-ufDqIk",
      "urn": "ACoAABxF9_ABHx785CFOZ24PjpTJvbvqi6CZH8M",
      "follower_count": 3809,
      "connection_count": 3557,
      "current_company": "RevFixr",
      "current_company_urn": "99534433",
      "current_company_url": "https://www.linkedin.com/company/revfixr",
      "email": null
    },
    "experience": [
      {
        "title": "Founder, Growth",
        "company": "RevFixr",
        "location": "Amsterdam, North Holland, Netherlands",
        "description": "RevFixr is the leading pricing and packaging agency in the Benelux focussed on SaaS pricing and monetisation.\n\nRevFixr helps with:\n1️⃣ Growing your recurring revenue\n2️⃣ Monetising your user/member base\n3️⃣ Increase company valuation\n4️⃣ Getting ready for series B and beyond\n5️⃣ Improve cashflow\n\n\"Monetization is our specialty. Growing your revenue is our responsibility.\"",
        "duration": "Jan 2024 - Present · 1 yr 8 mos",
        "start_date": {
          "year": 2024,
          "month": "Jan"
        },
        "is_current": true,
        "company_linkedin_url": "https://www.linkedin.com/company/99534433/",
        "company_logo_url": "https://media.licdn.com/dms/image/v2/D4D0BAQHux4cSJd3e5w/company-logo_400_400/company-logo_400_400/0/1721837758054/revfixr_logo?e=1758153600&v=beta&t=B2YrrMdgRY-fdO3EeGLcYHCCYv6_0y8Ma-4qLq4yDDs",
        "company_id": "99534433"
      },
      {
        "title": "Author | Money on the Table | Substack and Podcast",
        "company": "Money",
        "location": "Amsterdam, North Holland, Netherlands",
        "duration": "May 2025 - Present · 4 mos",
        "start_date": {
          "year": 2025,
          "month": "May"
        },
        "is_current": true,
        "company_linkedin_url": "https://www.linkedin.com/company/107767948/",
        "company_logo_url": "https://media.licdn.com/dms/image/v2/D4E0BAQFNqNVpiLTkww/company-logo_400_400/B4EZfj9nWZHsAY-/0/1751876270464?e=1758153600&v=beta&t=DuRn8cbdfW29x4RKfQaxWLVBE0Zjxn-8hoW-MBJMDv8",
        "employment_type": "on the Table",
        "company_id": "107767948"
      },
      {
        "title": "Venture Builder",
        "company": "Veylinx",
        "location": "Amsterdam, North Holland, Netherlands",
        "description": "Venture Builder at Veylinx, responsible for validating, testing, and building new business models. Focussing on Software(-as-a-Service) pricing.",
        "duration": "Oct 2023 - Aug 2024 · 11 mos",
        "start_date": {
          "year": 2023,
          "month": "Oct"
        },
        "end_date": {
          "year": 2024,
          "month": "Aug"
        },
        "is_current": false,
        "company_linkedin_url": "https://www.linkedin.com/company/4998229/",
        "company_logo_url": "https://media.licdn.com/dms/image/v2/D4E0BAQG7oiRS7pp5Ig/company-logo_400_400/company-logo_400_400/0/1730123313130/veylinx_logo?e=1758153600&v=beta&t=W4HHqrxg7XHFj4PyJV5Vzirs0YkBNizoPpPDXIboImM",
        "location_type": "Hybrid",
        "company_id": "4998229"
      },
      {
        "title": "Growth & Go-to-Market",
        "company": "Docfield",
        "location": "Amsterdam, North Holland, Netherlands",
        "description": "Create, collaborate, approve & e-Sign, and archive & extract documents & contracts with ease - Docfield.com",
        "duration": "Sep 2022 - Oct 2023 · 1 yr 2 mos",
        "start_date": {
          "year": 2022,
          "month": "Sep"
        },
        "end_date": {
          "year": 2023,
          "month": "Oct"
        },
        "is_current": false,
        "company_linkedin_url": "https://www.linkedin.com/company/35640066/",
        "company_logo_url": "https://media.licdn.com/dms/image/v2/C4E0BAQE5TZTSakYERg/company-logo_400_400/company-logo_400_400/0/1673974809473/jointhedocflow_logo?e=1758153600&v=beta&t=FYVraqWLwBxUq0Y5GOhSbSn0ig84Y_VEenTjUEUo608",
        "company_id": "35640066"
      },
      {
        "title": "Growth & Partnerships",
        "company": "Experfy",
        "location": "Greater Boston Area (Remote)",
        "description": "Incubated in Harvard Innovation Lab, the Experfy platform enables the pipelining and hiring of remote talent at unprecedented speed and scale. License our self-service platform or hire SME-vetted talent from our TalentClouds.",
        "duration": "Nov 2020 - Sep 2022 · 1 yr 11 mos",
        "start_date": {
          "year": 2020,
          "month": "Nov"
        },
        "end_date": {
          "year": 2022,
          "month": "Sep"
        },
        "is_current": false,
        "company_linkedin_url": "https://www.linkedin.com/company/3513709/",
        "company_logo_url": "https://media.licdn.com/dms/image/v2/C4E0BAQG4JiOTwM6MIQ/company-logo_400_400/company-logo_400_400/0/1631344698130?e=1758153600&v=beta&t=NvVZGFxhyulv83EKOn1oPXe0tGtf3JHmC9MdZGNRSso",
        "company_id": "3513709"
      }
    ],
    "education": [
      {
        "school": "BI Norwegian Business School",
        "degree": "Bachelor of Business Administration - BBA",
        "degree_name": "Bachelor of Business Administration - BBA",
        "duration": "2018 - 2018",
        "school_linkedin_url": "https://www.linkedin.com/company/165223/",
        "description": "Innovation & Entrepreneurship\nSocial Entrepreneurship\nFinancial Bubbles, Crashes & Crises\nConsumer Behaviour",
        "school_logo_url": "https://media.licdn.com/dms/image/v2/D4D0BAQHCtUB_6k0u0Q/company-logo_400_400/B4DZiJwdqOHsAc-/0/1754657840159/bi_norwegian_business_school_logo?e=1758153600&v=beta&t=EIPf_Vsr1MGZa4D6jSsR3kLPpdJo-9xZzvfpa6_JkAA",
        "start_date": {
          "year": 2018
        },
        "end_date": {
          "year": 2018
        },
        "school_id": "165223"
      },
      {
        "school": "Avans University of Applied Sciences",
        "degree": "Business Administration and Management, General",
        "degree_name": "Business Administration and Management",
        "field_of_study": "General",
        "duration": "2015 - 2019",
        "school_linkedin_url": "https://www.linkedin.com/company/13515/",
        "school_logo_url": "https://media.licdn.com/dms/image/v2/C4D0BAQFGwkWEXbj5uQ/company-logo_400_400/company-logo_400_400/0/1630466761929/avans_hogeschool_logo?e=1758153600&v=beta&t=FNJZfCCkvGXubkL3bL0Tya1asoP07c4Vu2vAX6rnaio",
        "start_date": {
          "year": 2015
        },
        "end_date": {
          "year": 2019
        },
        "school_id": "13515"
      }
    ],
    "languages": [
      {
        "language": "Dutch",
        "proficiency": "Native or bilingual proficiency"
      },
      {
        "language": "English",
        "proficiency": "Native or bilingual proficiency"
      }
    ],
    "profileUrl": "https://www.linkedin.com/in/ACoAABxF9_ABHx785CFOZ24PjpTJvbvqi6CZH8M"
  }
]


As you can see, it has public_identifier that is part of url like this: https://www.linkedin.com/in/yurevichcv/ , and also has "urn": "ACoAABxF9_ABHx785CFOZ24PjpTJvbvqi6CZH8M" . so you have both keys for unificaiton.

Here's fields you need to parse/keep in database:

1. First Name
2. Last Name
3. Profile Picture URL
4. Country
5. City

Also you need to show current latest (newest) experience, which you can check  "is_current": true , and if several - use latest. If no current, simply show latest.

show 

6. "title": 
7. "company": 
8. Is current (true/false)
9. "company_linkedin_url"

__

To implement, add button to Profile page called "Enrich", and allow running this actor just for selected profiles. 

Lastly, when implementing this scraping functionality, keep the same format (using progress-bar), up to 32 concurrent APIFY runs, and include up to 100 profiles in one run to enrich.  

---