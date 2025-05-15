import { CosmosClient, Container, PartitionKeyKind } from "@azure/cosmos";
import * as fs from "fs";
import { parse } from "csv-parse";
import { v4 as uuidv4 } from "uuid";

// Entity interfaces
export interface EventEntity {
    id: string; // EventId (Cosmos DB uses 'id' as the primary key)
    name: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    location?: string; // Added location property
}

export interface SessionEntity {
    id: string; // SessionId
    eventId: string; // Reference to parent event
    title: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    speakerIds?: string[]; // List of speaker IDs (for many-to-many)
}

export interface SpeakerEntity {
    id: string; // SpeakerId
    name: string;
    bio?: string;
}

export interface SponsorEntity {
    id: string; // SponsorId
    eventId: string; // Reference to parent event
    name: string;
    level?: string; // e.g., Gold, Silver, Bronze
}

export class EventInfrastructureService {
    private cosmosClient: CosmosClient;
    private databaseId: string;
    private eventsContainer: Container;
    private sessionsContainer: Container;
    private speakersContainer: Container;
    private sponsorsContainer: Container;

    constructor(connectionString: string, databaseId: string) {
        this.cosmosClient = new CosmosClient(connectionString);
        this.databaseId = databaseId;
        this.eventsContainer = this.cosmosClient.database(databaseId).container("Events");
        this.sessionsContainer = this.cosmosClient.database(databaseId).container("Sessions");
        this.speakersContainer = this.cosmosClient.database(databaseId).container("Speakers");
        this.sponsorsContainer = this.cosmosClient.database(databaseId).container("Sponsors");
    }

    // Create containers if they do not exist
    async createContainersIfNotExist(): Promise<void> {
        await this.cosmosClient.databases.createIfNotExists({
            id: this.databaseId
        });
        const db = this.cosmosClient.database(this.databaseId);
        await db.containers.createIfNotExists({ id: "Events", partitionKey: { paths: ["/id"], kind: PartitionKeyKind.Hash } });
        await db.containers.createIfNotExists({ id: "Sessions", partitionKey: { paths: ["/eventId"], kind: PartitionKeyKind.Hash } });
        await db.containers.createIfNotExists({ id: "Speakers", partitionKey: { paths: ["/id"], kind: PartitionKeyKind.Hash } });
        await db.containers.createIfNotExists({ id: "Sponsors", partitionKey: { paths: ["/eventId"], kind: PartitionKeyKind.Hash } });
    }

    /**
     * Imports sessions for a specific event from a CSV file.
     * @param filePath Path to the CSV file
     * @param eventId (Optional) The event ID to associate sessions with
     */
    async importSessionsForEvent(filePath: string, eventId?: string): Promise<void> {
        const records: any[] = [];
        // Read and parse CSV
        await new Promise<void>((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(parse({ columns: true, trim: true }))
                .on("data", (row: any) => records.push(row))
                .on("end", () => resolve())
                .on("error", (err: Error) => reject(err));
        });

        if (records.length === 0) return;

        // Speaker cache to avoid duplicates
        const speakerMap: Map<string, SpeakerEntity> = new Map();

        for (const row of records) {
            // Determine eventId: use parameter if provided, otherwise from CSV
            const rowEventId = eventId || row["Event ID"] || row["Event Id"] || row["Event id"] || row["eventId"];
            if (!rowEventId) {
                console.warn("Skipping row without Event Id:", row);
                continue;
            }
            // Parse speakers
            const speakersRaw = row["Session speakers"] || "";
            const speakerNames = speakersRaw.split(",").map((s: string) => s.trim()).filter(Boolean);
            const speakerIds: string[] = [];
            for (const speakerNameRaw of speakerNames) {
                // Sanitize speaker name to remove problematic escape sequences
                const speakerName = speakerNameRaw.replace(/\\/g, "");
                let speaker: SpeakerEntity | undefined = speakerMap.get(speakerName);
                if (!speaker) {
                    // Check if speaker exists
                    const { resources: existingSpeakers } = await this.speakersContainer.items
                        .query({ query: "SELECT * FROM c WHERE c.name = @name", parameters: [{ name: "@name", value: speakerName }] })
                        .fetchAll();
                    if (existingSpeakers.length > 0) {
                        speaker = existingSpeakers[0];
                    } else {
                        speaker = { id: uuidv4(), name: speakerName };
                        await this.speakersContainer.items.create(speaker);
                    }
                    if (speaker) {
                        speakerMap.set(speakerName, speaker);
                    }
                }
                if (speaker) {
                    speakerIds.push(speaker.id);
                }
            }
            // Create session
            const sessionEntity: SessionEntity = {
                id: uuidv4(),
                eventId: rowEventId,
                title: row["Session title"],
                description: row["Session description"],
                startTime: row["Session start time"],
                endTime: row["Session end time"],
                speakerIds
            };
            await this.sessionsContainer.items.create(sessionEntity);
        }
    }

    /**
     * Imports an event and its sponsors from a CSV file.
     * @param filePath Path to the CSV file
     */
    async importEventWithSponsorsFromCsv(filePath: string): Promise<void> {
        console.log(`Importing events and sponsors from ${filePath}`);
        const records: any[] = [];
        await new Promise<void>((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(parse({ columns: true, trim: true }))
                .on("data", (row: any) => records.push(row))
                .on("end", () => resolve())
                .on("error", (err: Error) => reject(err));
        });

        for (const row of records) {
            const eventName = row["Event name"];
            // Use Event ID from CSV if present, otherwise generate a new one
            let eventId = row["Event Id"] && row["Event Id"].trim() ? row["Event Id"].trim() : uuidv4();
            // Check if event exists by name
            const { resources: existingEvents } = await this.eventsContainer.items
                .query({ query: "SELECT * FROM c WHERE c.name = @name", parameters: [{ name: "@name", value: eventName }] })
                .fetchAll();
            if (existingEvents.length > 0) {
                eventId = existingEvents[0].id;
            } else {
                // Create event with all properties
                const eventEntity: EventEntity = {
                    id: eventId,
                    name: eventName,
                    description: row["Description"],
                    startDate: row["Start date"],
                    endDate: row["End date"],
                    location: row["Location"]
                };
                await this.eventsContainer.items.create(eventEntity);
            }

            // Parse sponsors
            const sponsorsRaw = row["Sponsors"] || "";
            const sponsorNames = sponsorsRaw.split(",").map((s: string) => s.trim()).filter(Boolean);
            for (const sponsorName of sponsorNames) {
                // Check if sponsor exists for this event
                const { resources: existingSponsors } = await this.sponsorsContainer.items
                    .query({ query: "SELECT * FROM c WHERE c.name = @name AND c.eventId = @eventId", parameters: [
                        { name: "@name", value: sponsorName },
                        { name: "@eventId", value: eventId }
                    ] })
                    .fetchAll();
                if (existingSponsors.length === 0) {
                    const sponsorEntity: SponsorEntity = {
                        id: uuidv4(),
                        eventId,
                        name: sponsorName
                    };
                    await this.sponsorsContainer.items.create(sponsorEntity);
                }
            }
        }
    }

    /**
     * Returns all events with their basic info (name, description, location, startDate, endDate)
     */
    async getAllEvents(): Promise<Array<Pick<EventEntity, "id" | "name" | "description" | "location" | "startDate" | "endDate">>> {
        const query = "SELECT c.id, c.name, c.description, c.location, c.startDate, c.endDate FROM c";
        const { resources } = await this.eventsContainer.items.query(query).fetchAll();
        return resources;
    }

    /**
     * Returns all sessions for a given eventId, or all sessions if eventId is not provided.
     * @param eventId (Optional) The ID of the event
     */
    async getSessionsByEventId(eventId?: string): Promise<any[]> {
        let sessions;
        if (!eventId) {
            // Return all sessions
            const result = await this.sessionsContainer.items
                .query("SELECT * FROM c")
                .fetchAll();
            sessions = result.resources;
        } else {
            const result = await this.sessionsContainer.items
                .query({ query: "SELECT * FROM c WHERE c.eventId = @eventId", parameters: [{ name: "@eventId", value: eventId }] })
                .fetchAll();
            sessions = result.resources;
        }
        // Collect all unique speaker IDs
        const speakerIdSet = new Set<string>();
        for (const session of sessions) {
            if (Array.isArray(session.speakerIds)) {
                session.speakerIds.forEach((id: string) => speakerIdSet.add(id));
            }
        }
        let speakerMap: Record<string, string> = {};
        if (speakerIdSet.size > 0) {
            const speakerIds = Array.from(speakerIdSet);
            const orClauses = speakerIds.map((id, idx) => `c.id = @id${idx}`).join(" OR ");
            const parameters = speakerIds.map((id, idx) => ({ name: `@id${idx}`, value: id }));
            const query = `SELECT c.id, c.name FROM c WHERE ${orClauses}`;
            const { resources: speakers } = await this.speakersContainer.items
                .query({ query, parameters })
                .fetchAll();
            speakerMap = Object.fromEntries(speakers.map((s: any) => [s.id, s.name]));
        }
        // Attach speaker names to each session
        return sessions.map(session => ({
            ...session,
            speakerNames: Array.isArray(session.speakerIds)
                ? session.speakerIds.map((id: string) => speakerMap[id]).filter(Boolean)
                : []
        }));
    }

    /**
     * Returns all speakers for a given eventId, or all speakers if eventId is not provided.
     * @param eventId (Optional) The ID of the event to filter speakers by
     */
    async getSpeakersByEventId(eventId?: string): Promise<SpeakerEntity[]> {
        if (!eventId) {
            // Return all speakers
            const { resources: speakers } = await this.speakersContainer.items
                .query("SELECT * FROM c")
                .fetchAll();
            return speakers;
        }
        // Get all sessions for the event
        const { resources: sessions } = await this.sessionsContainer.items
            .query({ query: "SELECT * FROM c WHERE c.eventId = @eventId", parameters: [{ name: "@eventId", value: eventId }] })
            .fetchAll();
        if (!sessions.length) return [];
        // Collect unique speaker IDs
        const speakerIdSet = new Set<string>();
        for (const session of sessions) {
            if (Array.isArray(session.speakerIds)) {
                session.speakerIds.forEach((id: string) => speakerIdSet.add(id));
            }
        }
        if (speakerIdSet.size === 0) return [];
        // Query speakers by IDs (batch query)
        const speakerIds = Array.from(speakerIdSet);
        const orClauses = speakerIds.map((id, idx) => `c.id = @id${idx}`).join(" OR ");
        const parameters = speakerIds.map((id, idx) => ({ name: `@id${idx}`, value: id }));
        const query = `SELECT * FROM c WHERE ${orClauses}`;
        const { resources: speakers } = await this.speakersContainer.items
            .query({ query, parameters })
            .fetchAll();
        return speakers;
    }


    /**
     * Returns all sponsors for a given eventId, or all sponsors if eventId is not provided.
     * @param eventId (Optional) The ID of the event
     */
    async getSponsorsByEventId(eventId?: string): Promise<SponsorEntity[]> {
        if (!eventId) {
            // Return all sponsors
            const { resources: sponsors } = await this.sponsorsContainer.items
                .query("SELECT * FROM c")
                .fetchAll();
            return sponsors;
        }
        const { resources: sponsors } = await this.sponsorsContainer.items
            .query({ query: "SELECT * FROM c WHERE c.eventId = @eventId", parameters: [{ name: "@eventId", value: eventId }] })
            .fetchAll();
        return sponsors;
    }
}
