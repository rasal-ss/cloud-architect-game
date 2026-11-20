# Cloud Architect: Scale or Fail — Game Design Document

Nov 20, 2026 · @Shardul

## Vision and pitch

Cloud Architect: Scale or Fail is a browser puzzle-strategy game where players design, scale, secure and rescue AWS architectures, from a single server to a global, multi-region platform serving millions of users. Every level is a real business problem with a budget, traffic targets and failures that will happen. The player wins by building something that survives.

**One-line pitch:** "Factorio meets the AWS Well-Architected Framework."

**Who it is for:**

- Recruiters and hiring managers, who can play for five minutes and see the creator's cloud, DevOps and database depth
- Developers and students learning AWS, system design and database design
- Engineers preparing for system-design interviews and AWS certifications

**Why it is a strong portfolio piece:**

- The game content proves domain knowledge: scaling, high availability, database design, security, cost and disaster recovery
- The game code proves engineering skill: a simulation engine, a graph editor, data-driven content and testing
- The game's own hosting proves DevOps skill: Terraform, CI/CD, serverless, observability and cost control
- Export to Terraform links the game to real infrastructure-as-code work

**Design pillars:**

1. **Real, not cartoon.** Services behave like their AWS counterparts: limits, latency, pricing shape and failure modes.
2. **Every fix creates the next problem.** Adding a cache brings stale data; adding replicas brings replication lag. This is how the game teaches.
3. **Trade-offs, not one right answer.** Cost, latency and reliability pull against each other, so stars reward balance.
4. **Simple to start, very deep to master.** Level 1 is one box; the final levels are multi-region platforms with 40+ components.

## Core gameplay loop and simulation

Each level runs the same loop: **read the brief, design, simulate, survive the incidents, review the score, improve.** The simulation is the heart of the game, so it must be believable, explainable and deterministic (the same design always gives the same result).

**The loop:**

1. **Brief.** A client message: "Our food-delivery app goes live Friday. Expect 2,000 RPS at dinner. Budget $1,200/month. Orders must never be lost."
2. **Design.** Drag services from the palette onto a canvas grid, place them in Regions, VPCs, AZs and subnets, connect them, and configure each one (instance size, replica count, capacity mode, TTL, partition key).
3. **Simulate.** Press Run. Simulated time passes (one in-game day in about 60 seconds) with a traffic curve: morning ramp, lunch peak, dinner spike.
4. **Incidents.** Scheduled and random chaos events strike mid-run (see the chaos section).
5. **Review.** A report card shows SLO results, cost breakdown, bottlenecks, a timeline of what broke and why, and hints.
6. **Iterate.** Change the design and run again. Best scores are saved.

**What the simulation models:**

| Factor | How it works in the game |
| --- | --- |
| Traffic | Requests per second following a curve, split by type: reads, writes, static, uploads, background jobs |
| Capacity | Each component has a max throughput; above 80% load latency rises sharply, above 100% requests queue, time out or are dropped |
| Latency | Every hop adds latency; the game tracks p50, p95 and p99 end to end |
| Cost | Hourly cost per component plus data transfer, requests, storage and cross-AZ/cross-region traffic, shown live as $/month |
| Reliability | Each component has a failure rate; single points of failure are flagged; availability is calculated per run |
| Data | Durability, consistency, replication lag, backup age (RPO) and recovery time (RTO) |
| Security | Public exposure, encryption, least privilege and network paths are scored |
| Connections | Databases have connection limits; Lambda bursts can exhaust them unless RDS Proxy is used |
| Warm-up | Auto Scaling takes minutes to add instances, Lambda has cold starts, caches start empty |

**Visual feedback:**

- Requests appear as moving dots along connections, coloured by type; failed requests flash red
- Components glow green, yellow or red by load; a heatmap view shows the whole system at a glance
- Click any component for live graphs: load, latency, errors, cost and queue depth (a mini CloudWatch)
- A replay timeline lets the player scrub back to the moment things went wrong

**Controls:** pause, 1x/4x/16x speed, step through incidents, undo/redo, copy/paste groups of components, and templates the player can save and reuse.

## Game modes

The game has nine modes, so it works as a learning path, a puzzle game, a sandbox and an interview tool. Campaign and Data Architect are the core; the rest can ship in later phases.

| Mode | What the player does | Skill shown |
| --- | --- | --- |
| Campaign | 15 acts, about 75 story levels for one growing startup, from launch day to global IPO | System design end to end |
| Data Architect | Dedicated database puzzles: schema, indexes, scaling, NoSQL modelling, migrations, analytics | Database architecture |
| Incident Response | A live production system is already on fire; find the root cause and fix it under a timer, using logs, metrics and traces | On-call, debugging, observability |
| Cost Crusher | An over-built, expensive architecture; cut the bill by X% without breaking SLOs | FinOps, right-sizing |
| Migration Missions | Move a legacy on-premise system (monolith, Oracle, file shares) to AWS with zero downtime | Migration strategy, the 7 Rs |
| Security Breach | Find and close the holes: public S3 buckets, open security groups, over-powered IAM roles, unencrypted data | Cloud security |
| Sandbox | Every service unlocked, custom traffic and budget, no objectives; build anything and stress-test it | Free design |
| Daily and weekly challenges | One shared puzzle per day with a global leaderboard (e.g. "cheapest design that survives an AZ outage at 10k RPS") | Optimisation |
| Interview Mode | A timed system-design prompt ("design a URL shortener", "design WhatsApp"); the game scores the design and gives feedback | Interview preparation |

**Multiplayer (later phase):**

- **Co-op Architect:** two players design one system together in real time, one on compute and one on data
- **Red vs Blue:** one player designs, the other picks chaos events to break it within a budget of "attack points"
- **Architecture Battles:** both players get the same brief; the better score after the same incidents wins

**Community features (later phase):**

- Level editor: players create briefs, traffic curves and incident scripts, then share them
- Share a design by link, with a read-only replay of its run
- Upvotes, featured community levels and a "hall of fame" for the cheapest or most resilient designs

## Service catalogue

About 60 AWS services, grouped into 11 categories and unlocked act by act, so the palette never overwhelms a new player. Each service has in-game stats (capacity, latency, cost shape, failure modes and limits) that are tuned for gameplay, not copied from real pricing.

| Category | Services | Unlocks in | In-game behaviour and trade-offs |
| --- | --- | --- | --- |
| Compute | EC2 (sizes t3 to c7/r7), Auto Scaling Groups, Spot, Lambda, ECS Fargate, EKS, App Runner, Elastic Beanstalk, Batch | Acts 1, 3, 6, 11 | EC2 is cheap at steady load but slow to scale; Lambda scales instantly but has cold starts and concurrency limits; Spot is 70% cheaper but can be reclaimed mid-run |
| Networking and delivery | VPC, public and private subnets, Internet Gateway, NAT Gateway, ALB, NLB, CloudFront, Route 53, Global Accelerator, VPC endpoints, Transit Gateway, PrivateLink | Acts 1, 3, 9, 12 | NAT is a hidden cost trap; cross-AZ traffic costs money; CloudFront cuts origin load and latency |
| Relational databases | RDS MySQL and PostgreSQL, Multi-AZ, read replicas, Aurora, Aurora Serverless v2, Aurora Global Database, RDS Proxy | Acts 2, 4, 5, 13 | Connection limits, replication lag, failover time, vertical scaling limits |
| NoSQL and specialised databases | DynamoDB (on-demand and provisioned), DAX, GSIs and LSIs, DynamoDB Streams, Global Tables, DocumentDB, Keyspaces, Neptune, Timestream, OpenSearch, MemoryDB | Acts 6, 8, 13 | Partition key design decides throughput; hot partitions throttle; eventual vs strong consistency |
| Caching | ElastiCache Redis and Memcached, DAX, CloudFront cache | Acts 4, 6 | Hit ratio drives savings; TTL drives staleness; cache stampede on cold start |
| Storage | S3 (Standard, IA, Glacier tiers), EBS (gp3, io2), EFS, S3 lifecycle rules, Backup | Acts 1, 5, 11 | Durability vs cost; IOPS limits on EBS; lifecycle rules save money over time |
| Messaging and events | SQS (standard and FIFO), SNS, EventBridge, Kinesis Data Streams, MSK (Kafka), Step Functions, DLQs | Acts 7, 10 | Queues absorb spikes; FIFO limits throughput; poison messages need DLQs |
| Analytics | Kinesis Firehose, Glue, Athena, Redshift, EMR, QuickSight, Lake Formation | Act 10 | Separates analytics from production load; batch vs streaming |
| Security and identity | IAM, Security Groups, NACLs, WAF, Shield, KMS, Secrets Manager, Cognito, GuardDuty, Security Hub | Acts 1, 9 | Missing controls cost security points; WAF blocks attack traffic |
| Observability and operations | CloudWatch metrics, logs and alarms, X-Ray, CloudTrail, Systems Manager, AWS Config | Acts 3, 11 | Without monitoring, incidents are detected later and recovery takes longer |
| DevOps and delivery | CodePipeline, CodeBuild, CodeDeploy, blue/green and canary deployments, ECR, CloudFormation | Act 11 | Bad deploys can be rolled back fast only if a strategy is in place |
| AI and ML (bonus act) | SageMaker endpoints, Bedrock, Rekognition | Act 14 | GPU-heavy, expensive, bursty inference traffic |

**Every service card in the game shows:** what it is, when to use it, when not to, its in-game stats, its cost model, and a link to the real AWS documentation. This turns the game into a learning reference as well.

## Campaign: 15 acts, 75 levels

The campaign follows one fictional startup, **NimbusCart** (a grocery-delivery app), from 10 users to 50 million. Each act has 5 levels: 4 teaching levels and a boss level that combines everything in the act under heavy incidents. Users and budget grow every act, so earlier designs must evolve rather than be thrown away.

| Act | Story stage | Scale | Levels (the 5th is the boss) |
| --- | --- | --- | --- |
| 1. Hello Cloud | Founder's weekend project | 10 users | One EC2 web server; add an Elastic IP and security group; move images to S3; put CloudFront in front; **Boss: launch day on a $20 budget** |
| 2. First Database | First paying customers | 1k users | Database on the same EC2 (and why it breaks); move to RDS; pick an instance size; automated backups; **Boss: the server dies, don't lose a single order** |
| 3. Growing Pains | Featured on the app store | 50k users | Add an ALB and a second server; Auto Scaling on CPU; spread across 2 AZs; health checks and alarms; **Boss: a 10x spike in 3 minutes** |
| 4. Database Bottleneck | Reads overwhelm the database | 200k users | Read replicas; read/write splitting; ElastiCache cache-aside; TTL and stale-data trade-off; **Boss: Black Friday sale with a cold cache** |
| 5. Always On | First enterprise client with a 99.9% SLA | 500k users | RDS Multi-AZ failover; stateless servers and session storage; backups vs snapshots vs point-in-time restore; RTO/RPO targets; **Boss: an entire AZ goes down at peak** |
| 6. Go Serverless | New team builds a mobile API | 1M users | API Gateway + Lambda; DynamoDB basics; partition key choice; Lambda + RDS connection storm fixed with RDS Proxy; **Boss: a viral coupon creates a hot partition** |
| 7. Decouple Everything | Order processing keeps timing out | 2M users | SQS between checkout and payment; SNS fan-out to email, SMS and analytics; DLQs and retries with backoff; Step Functions order workflow; **Boss: the payment provider is down for 20 minutes** |
| 8. The Data Architect | Data grows and queries slow down | 5M users | Normalise the schema; add the right indexes; choose SQL vs NoSQL per feature; Aurora migration; **Boss: zero-downtime schema change on a 2 TB table** |
| 9. Lock It Down | A security audit before a funding round | 5M users | Private subnets and NAT; least-privilege IAM; encryption with KMS and Secrets Manager; WAF and Shield; **Boss: a live attack (SQL injection + DDoS + leaked key)** |
| 10. Real-time and Analytics | Live order tracking and business dashboards | 10M users | Kinesis for driver GPS events; WebSockets via API Gateway; data lake on S3 + Glue + Athena; Redshift for reporting; **Boss: analytics queries must not slow down checkout** |
| 11. Ship It Safely | 50 engineers deploy daily | 10M users | CI/CD pipeline; blue/green deploys; canary with automatic rollback; containers on ECS/EKS; **Boss: a bad release goes out at peak hour** |
| 12. Go Global | Launch in Europe and Asia | 25M users | Route 53 latency routing; multi-region read stacks; data residency rules (EU data stays in the EU); global edge with CloudFront + Global Accelerator; **Boss: users in Mumbai complain about 900 ms latency** |
| 13. Global Data | Data must be consistent worldwide | 25M users | Aurora Global Database; DynamoDB Global Tables; conflict resolution; active-passive vs active-active; **Boss: a full region outage with RPO under 1 minute** |
| 14. Smart Platform | AI features: recommendations and image checks | 40M users | Feature store and model endpoint; async inference with queues; GPU cost control; caching predictions; **Boss: a recommendation model goes viral and costs explode** |
| 15. The IPO | Final audit before going public | 50M users | Cost optimisation review (Savings Plans, Spot, right-sizing); a Well-Architected review across all 6 pillars; disaster recovery drill; a multi-account setup with Organizations; **Final boss: "The Perfect Storm", a 24-hour run with a sale, a region outage, a DDoS attack and a bad deploy, all on a fixed budget** |

**After the campaign:** New Game+ replays every level with tighter budgets, harsher incidents and a hidden fourth star for designs that experts rate as optimal.

## Data Architect mode: database architecture

Data Architect is a full second campaign of 8 tiers and about 40 puzzles. It covers everything from a first table to a global data platform. Its screens differ from the main canvas: a schema designer, a query lab, a key-design board and a data-flow map.

**Tier 1: Schema design (relational modelling)**

- **Normalisation puzzle:** a messy spreadsheet of orders arrives; drag columns into tables to reach 1NF, 2NF and 3NF. Duplicated data glows red until it is removed.
- **Relationships:** draw one-to-one, one-to-many and many-to-many links; the game adds the junction tables and foreign keys.
- **Data types and constraints:** choose types, NOT NULL, UNIQUE and CHECK; wrong choices cause corrupt data events later in the level.
- **When to denormalise:** a read-heavy dashboard is too slow; decide which fields to copy and accept the update cost.

**Tier 2: Indexing and query performance (the Query Lab)**

- Slow queries appear with an execution plan drawn as a tree; the player adds indexes and watches the plan change from a full table scan to an index seek.
- Puzzles on composite index column order, covering indexes, partial indexes and over-indexing (too many indexes slow down writes).
- Fix N+1 queries, missing LIMITs and SELECT \* in a mock application log.

**Tier 3: Transactions and concurrency**

- Two users buy the last item at the same moment; choose isolation levels and locking to stop overselling.
- Deadlock puzzle: reorder operations so two transactions stop blocking each other.
- Optimistic vs pessimistic locking, idempotency keys for payment retries.

**Tier 4: Scaling relational databases**

A fixed path where each step solves one problem and creates the next:

1. Vertical scaling (bigger instance), until it hits the largest size and the cost explodes
2. Read replicas, which bring replication lag and stale reads
3. Caching, which brings invalidation problems
4. Connection pooling with RDS Proxy, for serverless clients
5. Partitioning large tables by date
6. Sharding by customer ID, which makes cross-shard queries and rebalancing hard
7. Aurora, with its storage-level replication and fast failover

**Tier 5: NoSQL modelling (DynamoDB)**

- **Access patterns first:** the player gets a list of queries the app needs, then designs keys to serve them all.
- **Key design board:** choose partition and sort keys; a live heatmap shows traffic per partition and throttling on hot keys.
- **Single-table design:** fit users, orders and items into one table using composite keys and overloaded GSIs.
- **Write sharding:** spread a viral item's writes across key suffixes.
- **Capacity modes:** on-demand vs provisioned with auto scaling, and the cost difference under spiky and steady traffic.

**Tier 6: Choosing the right database (polyglot persistence)**

Each feature of NimbusCart needs a store. The player matches each one and justifies the choice:

| Feature | Best fit in the game | Why |
| --- | --- | --- |
| Orders and payments | Aurora PostgreSQL | Transactions and strong consistency |
| Shopping cart and sessions | DynamoDB or ElastiCache | Fast key-value access at high scale |
| Product search | OpenSearch | Full-text search and filters |
| Friend recommendations | Neptune | Graph relationships |
| Driver GPS history | Timestream | Time-series data |
| Product images | S3 | Cheap, durable object storage |
| Sales reporting | Redshift | Analytical queries over large data |

**Tier 7: Consistency, replication and distributed data**

- Strong vs eventual consistency: a "bank balance" level breaks if reads go to a lagging replica.
- CAP and PACELC trade-offs shown with a network partition event.
- Multi-region writes and conflict resolution (last writer wins vs application merge).
- Event-driven data: the outbox pattern, change data capture with DynamoDB Streams, CQRS and event sourcing.

**Tier 8: Migration, operations and analytics**

- Zero-downtime migrations: expand-and-contract schema changes, dual writes, backfills.
- Move Oracle on-premise to Aurora with DMS and the Schema Conversion Tool.
- Backup strategy: snapshots, point-in-time recovery and cross-region copies, scored against RPO and RTO.
- Build the analytics pipeline: production database to CDC, to S3 data lake, to Glue, to Athena or Redshift, without touching production performance.
- Data security: encryption at rest and in transit, row-level access, masking personal data, audit logs.

**Database boss:** "The Great Migration". Move NimbusCart's 5 TB monolith database to a polyglot, multi-region design during live traffic, with no lost orders and less than 30 seconds of write downtime.

## Chaos, incidents and events

About 40 incident types test whether a design really holds up. Early levels warn the player before an incident hits; later levels give no warning, and the boss levels stack several at once. Each incident has a real-world lesson attached in its post-mortem.

| Category | Incidents |
| --- | --- |
| Traffic | Viral spike (10x to 50x), flash sale, TV advert, bot scraping, slow ramp that outgrows a fixed fleet, festival traffic (Diwali sale, New Year's Eve) |
| Infrastructure | Instance crash, AZ outage, full region outage, EBS volume degraded, Spot instance reclaimed, NAT Gateway failure, noisy neighbour |
| Database | Primary failover, replication lag spike, connection exhaustion, hot partition, long-running query locks a table, storage full, accidental DROP TABLE (needs point-in-time restore) |
| Application | Memory leak, bad deploy, a config error, a retry storm, a cache stampede after a flush, a poison message stuck in a queue |
| Dependencies | Third-party payment API down, slow DNS, expired SSL certificate, a downstream service rate-limits you |
| Security | DDoS, SQL injection, credential leak on GitHub, public S3 bucket found, ransomware on an EC2 instance, an insider with too many permissions |
| Business | Budget cut by 30% mid-month, a new data-residency law, a client demands 99.99% uptime, a compliance audit (PCI, GDPR) |

**How incidents play out:**

- **Detection:** if CloudWatch alarms are set up, the player is alerted in seconds. Without monitoring, customers notice first and a "support tickets" counter climbs.
- **Response actions** during the run (later acts): fail over manually, scale up, turn on WAF rules, roll back a deploy, flush or warm the cache, pause a queue consumer. Each action has a delay and a cost.
- **Runbooks:** players can write automated responses ("if CPU > 80% for 5 minutes, add 2 instances"); later levels reward automation over manual clicking.
- **Post-mortem:** after the run, a blameless post-mortem report shows the timeline, root cause, impact (failed requests, lost revenue, SLO budget used) and what would have prevented it.

## Progression, scoring and achievements

Scoring is based on the six pillars of the AWS Well-Architected Framework, so a high score means the design would pass a real architecture review.

**Level score (out of 100), turned into 1 to 3 stars:**

| Pillar | What is measured |
| --- | --- |
| Reliability | Availability achieved, requests failed, survived incidents, no single points of failure |
| Performance | p95 and p99 latency against target, throughput headroom |
| Cost | Monthly cost against budget; bonus for coming in well under it |
| Security | Private networking, encryption, least privilege, no public exposure |
| Operational excellence | Monitoring, alarms, automation, deployment safety |
| Sustainability | Right-sized resources, idle capacity, efficient instance types |

Each level weights the pillars differently. A startup launch level weights cost heavily; a bank level weights reliability and security.

**Player progression:**

- **Architect rank:** Intern, Junior, Associate, Senior, Principal, Distinguished. Rank rises with stars earned.
- **Skill tree:** points unlock perks such as "auto-suggest bottlenecks", "cost forecast", "incident early warning" and "replay at 64x".
- **In-game certifications:** completing related levels earns badges named after the real paths: Cloud Practitioner, Solutions Architect, DevOps Engineer, Database Specialty, Security Specialty. Each badge links to the real AWS certification page.
- **Company growth meter:** NimbusCart's users, revenue and reputation grow with good designs and drop after outages, so the story reflects the player's skill.

**Achievements (examples):**

- **Five Nines:** finish a level with 99.999% availability
- **Penny Pincher:** finish under 50% of budget with 3 stars
- **Chaos Monkey:** survive 5 incidents in a single run
- **No Single Point:** finish an act with no SPOF warnings
- **Index Wizard:** solve every Query Lab puzzle with the minimum number of indexes
- **Zero Downtime:** complete a migration with no failed writes
- **Global Citizen:** serve all regions under 100 ms p95

**Leaderboards:** global, friends and weekly, with separate boards for cheapest, fastest and most resilient designs.

## Real-world features

These features connect the game to real cloud work. They are what make the project stand out to recruiters.

- **Export to Terraform:** any design exports as a ready-to-read Terraform project (modules per component, variables, outputs). A CloudFormation and AWS CDK export can follow.
- **Import from Terraform (advanced):** paste a simple Terraform file and the game draws the architecture, then stress-tests it.
- **Database schema export:** schemas from Data Architect export as SQL DDL (PostgreSQL/MySQL) and DynamoDB table definitions in JSON.
- **Architecture diagram export:** download the design as PNG or SVG using AWS-style icons, ready for a slide or a README.
- **Cost estimate report:** a monthly cost breakdown per service, in the style of the AWS Pricing Calculator, with a clear note that in-game prices are approximate.
- **Well-Architected report:** a PDF-style review listing risks per pillar, with links to the relevant AWS guidance.
- **Interview replay:** after Interview Mode, a written summary of the design, trade-offs and weaknesses that a player can study or share.

**Safety rule:** the game never deploys to a real AWS account. Export only generates code for the player to review and run themselves.

## Technical architecture of the game

The simulation runs entirely in the player's browser, so the backend only stores progress, scores and shared designs. That keeps the AWS bill close to zero when nobody is playing, which is itself a point worth making to recruiters.

&#91;embedded content: Game hosting architecture on AWS · 9 services\]

The browser loads the game from CloudFront and S3, signs in through Cognito, and calls API Gateway; Lambda writes to DynamoDB and hands slow work (Terraform export zips, leaderboard rebuilds, replays) to queues.

**Stack:**

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + TypeScript + Vite | Fast, typed, widely known |
| Canvas | React Flow (or PixiJS for the traffic animation layer) | Drag, connect and zoom out of the box |
| State | Zustand | Simple, fast state for a large graph |
| Simulation engine | Pure TypeScript package, run in a Web Worker | Keeps the UI smooth; testable on its own |
| Content | Levels, services and incidents as JSON/YAML files validated with a schema | New levels need no code changes |
| Backend | API Gateway + Lambda (Node.js or Python) | Serverless, scales to zero |
| Database | DynamoDB single-table design | Players, progress, designs, leaderboards in one table |
| Auth | Cognito with Google sign-in, plus guest play | Low friction for recruiters |
| Infrastructure | Terraform with dev and prod workspaces, remote state in S3 | Shows IaC skill |
| CI/CD | GitHub Actions: lint, unit tests, simulation tests, build, Terraform plan/apply, deploy, cache invalidation | Shows DevOps skill |
| Quality | Vitest for the engine, Playwright end-to-end tests, Lighthouse checks | Shows engineering discipline |
| Observability | CloudWatch dashboards and alarms, X-Ray tracing, a cost budget alert | Practises what the game teaches |

**Simulation engine design (the hardest and most impressive part):**

- The architecture is a directed graph; each node has capacity, latency and failure properties.
- Each simulation tick (one in-game second) routes traffic through the graph, applies queueing (a simple M/M/c approximation for latency under load), and records metrics.
- Incidents are scripted events on a timeline plus seeded random events, so every run can be replayed exactly.
- The engine has no UI code, so it can also run in Node.js for automated tests and for checking that every level is solvable.
