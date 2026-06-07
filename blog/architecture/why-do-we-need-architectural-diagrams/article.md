# Why Do We Need Architectural Diagrams?

## Content

- [What we do wrong and how we can improve](#what-we-do-wrong-and-how-we-can-improve)
- [But … what do we need architectural diagrams for?](#but-what-do-we-need-architectural-diagrams-for)
- [My practical example](#my-practical-example)

#### *According to the licensing policy, I would like to mention this article was originally published on [InfoQ](https://www.infoq.com/articles/why-architectural-diagrams).*

### Key Takeaways

- Creating and maintaining architectural diagrams to provide accurate and valuable content is not easy. Most of the time we create either too much, too little or irrelevant documentation because we fail to identify the proper beneficiaries and their real needs.
- One of the biggest mistakes is to create detailed architectural diagrams for parts of the system with high volatility. It is a burden to manually maintain them unless they are automatically generated.
- In practice, most stakeholders are not interested in detailed diagrams, but rather in one or two high-level diagrams which reflect the modularity and boundaries of the system. Beyond these, for a deeper understanding, the code should be the source of truth, which in most of the cases only developers are interested in.
- To find the appropriate amount of quantity and quality of architectural diagrams,  brainstorm and agree with the team what is really useful for them, whatever that means! Do not try to create diagrams for things that are self-explanatory in the source code or for the sake of any comprehensive architectural methodology.
- The main purpose of architectural diagrams should be to facilitate collaboration, to increase communication, and to provide vision and guidance.
- Paint one or two high-level diagrams on the wall and use them during meetings (stand-ups, etc). You, as an architect, should make them visible, valuable, and part of the project culture. Do not keep them hidden or in places less accessible for the stakeholders.

We try to create architectural diagrams (as part of the technical documentation) aiming to reflect the internal state of the application, but most of the time we do not do it properly. The resulting diagrams can range from very comprehensive to extremely vague. Sometimes, the diagrams are simply irrelevant. I previously wrote a few tips on how to [create useful architectural diagrams.](https://ionutbalosin.com/2017/09/the-art-of-crafting-architectural-diagrams)

Even when relevant diagrams are created, we rarely keep such documentation updated with the feature which is being developed as part of an integrated continuous development process. In reality, the documentation is updated only from time to time, probably during some sprints (when there is time for such activity), or for a specific release. On the other hand, most of the developers I interacted with (colleagues or students attending my  course) are not in favor of creating and maintaining technical documentation; they consider it tedious, time-consuming, and less valuable than other work, or even unnecessary when source code is enough. While there will always be exceptions, I am pretty sure when it comes to architectural diagrams things are pretty much the same in most of the projects.

## What we do wrong and how we can improve

First of all, it is important to understand who are the real beneficiaries of architectural diagrams and technical documentation. The quantity and quality of the documentation should reflect the stakeholders’ needs, since only this way we can create accurate and just enough documentation.

The main beneficiary should be the team (developers, test engineers, business analysts, devops, etc.) who have direct involvement in the project. In my experience, outside of the team, there are very few stakeholders who really care about documentation. In the best case, they might be interested in one or two high-level diagrams (e.g. context diagram, application or software component diagram) which roughly describe the structure of the system and give a high-level understanding of it.

However, most of the time we fail in identifying the real beneficiaries and their real needs and try to create too much documentation. This quickly becomes a burden to maintain and is quite soon outdated. In other cases, we just simply omit to create any kind of diagram because there is no time, no specific interest, or nobody wants to take on this responsibility. Besides this, the Agile Manifesto prescribes that teams should value working software over comprehensive documentation, which discourages cumbersome documentation processes.

In order to find the appropriate balance of the right documentation level, try this exercise in your team: go to ask each of your colleagues what they really need out of the technical documentation and what types of diagrams it should include. Collect their input, then brainstorm and agree together on what is really necessary for the team. There might be one or two influential stakeholders outside of the team with extra requests, and it is the responsibility of the architect to take their needs into account, as well. Based on that, create the appropriate quantity and level of technical documentation which fulfills the stakeholders’ needs. If developers understand the real value of the documentation and have as interest in its remaining valuable, they will be encouraged to contribute and properly maintain it. In the end, everybody becomes happy. However, if they do not understand the necessity or they do not care, you can almost forget about it, since documentation becomes very difficult to maintain by a just single person (the architect) when this must be a shared responsibility among the team members.

In the past, on waterfall projects, we created too much documentation derived from comprehensive enterprise architecture methodologies (I intentionally do not name any of them) or requested by some ivory tower architects. When agile methodologies were embraced at large scale in software projects, one common, big misunderstanding was people thinking they did not need any documentation, because working software is more important than creating comprehensive documentation. These are the two extreme cases, of course. There is no precise methodology or scientific process to explicitly address the appropriate amount of documentation for a project. All current software architecture methodologies are pure recommendations or guidelines. Those comprehensive architectural processes followed in the past are nowadays substantially simplified to non-existence in the projects. It doesn’t mean we should create less documentation or no documentation at all, but rather be focused on creating documentation that provides real value and at the same time does not hinder the team’s progress. Besides that, not all documentation provides value. But that isn’t the same as “all documentation provides no value.” Additionally, what makes sense for one project might be less relevant for another due to a different context (e.g. economic, political, etc.), business goals, stakeholders, etc.

Under these circumstances, it is very difficult to get the right answer to the question: what is the appropriate amount of technical documentation (i.e. architectural diagrams)? In the end, it relates to each project and to the architect experience, and could be summarized as “IT DEPENDS.” The right amount of documentation to provide value depends on what your team has decided they need. My advice is to decide together with the team and to ***create just enough technical documentation, whatever that means for your team***. If no documentation makes sense for your project (why not!?), that might be acceptable. Document the rationale behind this teaming agreement and make it transparent for all stakeholders. If there are two or three diagrams of real interest, then make sure they are updated, consistent and always reflect the state of the system. Do not focus on anything else which might not bring any value.

## But … what do we need architectural diagrams for?

The architectural diagrams in particular and the documentation, in general, should be primarily used for collaboration, communication, vision and guidance inside the team and across teams. It must also include the significant design decisions in the project (taken at a certain moment of time), but nothing more.

Architectural diagrams should help everybody to see the big picture and to understand the surroundings. In my opinion, this should be the fundamental reason behind creating and maintaining the architectural diagrams.

For example, context diagrams perfectly fulfill such a need and provide a great level of detail about system boundaries, seeing the big picture. It helps the team to have a common understanding and ease communication across different stakeholders. I attended many meetings when such a context diagram, presented on the big screen, saved a lot of questions and removed the uncertainties about the high-level system architecture.

However, we often we try to create comprehensive documentation to reflect the internal state of the system. This can take the form of state diagrams, activity diagrams, class diagrams, entity diagrams, concurrency diagrams, etc. But these quickly become out of date, unless they are automatically generated out of the source code by some “magic” tools.

What would be the purpose of creating such detailed diagrams if people do not need, read or maybe understand them? Abstract diagrams for business stakeholders are more than enough. For developers, in most of the cases, the source code (i.e. single source of truth) is what they really need in order to understand the application. So, please stop creating diagrams for things that are self-explanatory in the code, too detailed, or when there is no real audience.

Create meaningful, but minimal, architectural diagrams and incorporate them in the technical documentation. For the majority of applications, there are probably two or three types of such significant diagrams needed. The most common are context diagrams, application/software component diagrams, system diagrams, or deployment diagrams.

## My practical example

In my project I use mainly two types of diagrams:

- **context diagrams**

![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/architecture/why-do-we-need-architectural-diagrams/1why-architectural-diagrams-1-1547639072090.jpg)

- **application or software component diagrams**

![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/architecture/why-do-we-need-architectural-diagrams/1why-architectural-diagrams-2-1547639071547.jpg)

Please treat these diagrams as simple examples, showing some guidance about a reasonable level of information each diagram should provide. **Information on one diagram should be relevant to the corresponding abstraction level, but also must fulfill stakeholders needs.** In practice, it might be tempting to add more and more details to a diagram, but if they are not really useful to the beneficiaries, it leads to extra noise, increased maintenance and the risk of being out of date. Specific to these diagrams, including details like protocols and data format might be very handy for technical stakeholders, since they are a necessary implementation detail. However, as also stated in the article, there is no precise methodology to explicitly describe the appropriate amount of details a diagram should include. It really depends from project to project, nevertheless, the architect must identify what is really useful for the stakeholders and create and maintain the diagrams to properly reflect that.

For any extra detail besides these diagrams, I could either find it in the source code or get it automatically generated by some tools (e.g. runtime view diagrams, development view diagrams, system or infrastructure view diagrams, etc).

I also painted the software architecture diagram (including all application components) in our meeting room. During our stand-ups and other meetings, people talk about their tasks, statuses, and impediments while pointing to this diagram on the wall. This way, every team member, from product owner to developer, understands and sees the big picture and foresees the overall impediments and other integration challenges. Besides that, it offers a more accurate progress status during the Sprint for the entire team, especially when the architecture is distributed and there are dependencies between people.

I advise you to do the same for your team. Keep on increasing collaboration, communication, vision, and guidance by using just enough architectural diagrams, and stop creating them for any other reasons, especially if the team does not use them. Manually creating and maintaining diagrams to reflect the code behavior is, in most of the cases, a waste of time. In doing so, you might be tempted to add more and more such diagrams as source code evolves, which is a dangerous trap. Rather than creating an exhausting number of diagrams, stick to two or three which describe the system from different levels of abstractions and are really necessary for the team. Always keep them updated; this task is made easier when it does not contain too many details and it is part of the team culture.

Also, keep in mind the team should be the main beneficiary of architectural diagrams. If they do not manifest any interest, then you should probably stop creating them; it might be waste of time. We should not create architectural diagrams just “for the sake of having them,” to follow some comprehensive methodologies, or to justify our role as Architects.

---

**Tags**: Software Architecture, Architectural Diagrams, Documentation, Software Design, System Design, Communication, Software Engineering, Diagrams
